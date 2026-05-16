from __future__ import annotations

from typing import Any

from fastapi import APIRouter


def create_health_router(facade: Any) -> APIRouter:
    router = APIRouter()

    @router.get("/health")
    def health() -> dict[str, Any]:
        return facade.health()

    return router
