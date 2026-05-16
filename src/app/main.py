from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.errors import app_error_handler, unhandled_error_handler
from app.api.middleware import request_id_middleware, timing_middleware
from app.api.routes import create_health_router
from app.api.v1 import create_v1_router
from app.common.config import settings
from app.common.exceptions import AppError
from app.common.logging import logger
from app.infrastructure.database.connection import init_db
from app.infrastructure.factory import ServiceFactory


def create_application(
    model: str | None = None,
    provider: str | None = None,
) -> FastAPI:
    facade = ServiceFactory.create_facade(explicit_model=model, provider=provider)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.facade = facade
        init_db()
        facade.recover_from_disk()
        facade.cleanup(days=7)
        yield

    app = FastAPI(
        title="AI Test API",
        description="Webhook + Ollama runner powered by FastAPI",
        version="2.0.0",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.middleware("http")(timing_middleware)
    app.middleware("http")(request_id_middleware)

    app.add_exception_handler(AppError, app_error_handler)  # type: ignore[arg-type]
    app.add_exception_handler(Exception, unhandled_error_handler)  # type: ignore[arg-type]

    # Unversioned routes
    app.include_router(create_health_router(facade))

    # Versioned API routes
    app.include_router(create_v1_router(facade), prefix=settings.api_prefix)

    logger.info("app_started")
    return app


app = create_application()
