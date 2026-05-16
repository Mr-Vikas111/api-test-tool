from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request

from app.api.schemas import WebhookPayload

log = logging.getLogger(__name__)


def create_v1_router(facade: Any) -> APIRouter:
    router = APIRouter()

    @router.get("/results/{batch_id}")
    def get_results(batch_id: str) -> dict[str, Any]:
        entry = facade.get_results(batch_id)
        if entry is None:
            raise HTTPException(status_code=404, detail=f"Unknown batch_id: {batch_id}")
        return entry

    @router.get("/results/{batch_id}/request/{seq}")
    def get_request_result(batch_id: str, seq: int) -> dict[str, Any]:
        entry = facade.get_request_result(batch_id, seq)
        if entry is None:
            raise HTTPException(status_code=404, detail=f"Request seq {seq} not found in batch {batch_id}")
        return entry

    @router.get("/batches/{batch_id}/requests")
    def get_batch_requests(batch_id: str) -> dict[str, Any]:
        entry = facade.get_batch_requests(batch_id)
        if entry is None:
            raise HTTPException(status_code=404, detail=f"Unknown batch_id: {batch_id}")
        return entry

    @router.get("/batches")
    def list_batches(limit: int = Query(default=50, ge=1, le=500)) -> dict[str, Any]:
        return facade.list_batches(limit=limit)

    @router.get("/admin/cleanup")
    def cleanup(days: int = Query(default=7, ge=1, le=365)) -> dict[str, Any]:
        return facade.cleanup(days=days)

    @router.post("/webhook")
    def webhook(payload: WebhookPayload, request: Request) -> dict[str, Any]:
        if not payload.requests:
            raise HTTPException(status_code=400, detail="'requests' must be a non-empty list")
        client_ip = request.client.host if request.client else "unknown"
        batch_id = facade.create_pending_batch(client_ip)
        host = request.headers.get("host", "127.0.0.1:5055")
        results_url = f"http://{host}/api/v1/results/{batch_id}"
        log.info("[Webhook] Batch %s accepted — processing will start shortly", batch_id)
        facade.start_background(batch_id, payload.requests, client_ip)
        return {
            "ok": True,
            "batch_id": batch_id,
            "results_url": results_url,
            "message": "Batch accepted for processing",
        }

    return router
