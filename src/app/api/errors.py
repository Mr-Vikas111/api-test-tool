from fastapi import Request
from fastapi.responses import JSONResponse
from pydantic import ValidationError as PydanticValidationError

from app.common.exceptions import AppError
from app.common.logging import logger
from app.common.response import error_response


async def app_error_handler(request: Request, exc: AppError) -> JSONResponse:
    logger.warning("app_error", code=exc.code, message=exc.message, detail=exc.detail)
    return JSONResponse(
        status_code=exc.status_code,
        content=error_response(code=exc.code, message=exc.message, details=exc.detail).model_dump(),
    )


async def unhandled_error_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("unhandled_error")
    return JSONResponse(
        status_code=500,
        content=error_response(code="INTERNAL_ERROR", message="An unexpected error occurred").model_dump(),
    )


async def pydantic_validation_handler(request: Request, exc: PydanticValidationError) -> JSONResponse:
    return JSONResponse(
        status_code=422,
        content=error_response(
            code="VALIDATION_ERROR",
            message="Request validation failed",
            details={"errors": exc.errors()},
        ).model_dump(),
    )
