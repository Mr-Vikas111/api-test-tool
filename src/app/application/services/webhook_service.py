"""Application services and orchestration logic for webhook processing."""

from __future__ import annotations

import threading
from typing import Any

from app.application.services.orchestrator_service import AgentOrchestrator
from app.application.interfaces.llm_adapter import AdapterFactory, LLMAdapter
from app.common import sanitize
from app.infrastructure.database import batch_store as store_module
from app.infrastructure.external import ollama_client


class BatchProcessor:
    def __init__(self, db: store_module.BatchStore, model: str, adapter: LLMAdapter | None = None) -> None:
        self._db = db
        self._model = model
        self._orchestrator = AgentOrchestrator(model=model, db=db, adapter=adapter)

    def process_batch(self, batch_id: str, raw_requests: list[dict[str, Any]], client_ip: str = "unknown") -> None:
        log = __import__("logging").getLogger(__name__)
        try:
            requests_list, filter_report = sanitize.filter_requests(raw_requests)
        except sanitize.ValidationError as exc:
            self._db.set_status(batch_id, status=store_module.STATUS_ERROR, message=str(exc))
            self._db.finalise(batch_id)
            return

        if not requests_list:
            self._db.set_status(batch_id, status=store_module.STATUS_ERROR,
                                message="All requests were dropped during validation", filter_report=filter_report)
            self._db.finalise(batch_id)
            log.warning("[BatchProcessor] Batch %s — all %d request(s) dropped", batch_id, filter_report.get("original", 0))
            return

        self._db.store_validated_requests(batch_id, requests_list, filter_report)
        log.info("[BatchProcessor] Batch %s — %d/%d requests valid, starting pipeline",
                 batch_id, len(requests_list), filter_report.get("original", 0))
        self._orchestrator.run_batch(batch_id, requests_list)


class WebhookFacade:
    def __init__(self, db: store_module.BatchStore, processor: BatchProcessor, model: str) -> None:
        self._db = db
        self._processor = processor
        self._model = model

    @property
    def model(self) -> str:
        return self._model

    def health(self) -> dict[str, Any]:
        from pathlib import Path
        return {
            "status": "ok",
            "server": "ai-test-api webhook + Ollama runner (FastAPI)",
            "ollama_model": self._model,
            "ollama_models": ollama_client.list_models(),
            "storage": str(Path(__file__).resolve().parents[3] / "storage"),
        }

    def get_results(self, batch_id: str) -> dict[str, Any] | None:
        return self._db.get(batch_id) or self._db.get_from_disk(batch_id)

    def get_batch_requests(self, batch_id: str) -> dict[str, Any] | None:
        batch = self._db.get(batch_id)
        if batch is None:
            return None
        requests_data = self._db.get_requests(batch_id)
        return {"batch_id": batch_id, "total": len(requests_data), "requests": requests_data}

    def get_request_result(self, batch_id: str, seq: int) -> dict[str, Any] | None:
        return self._db.get_request_results(batch_id, seq)

    def list_batches(self, limit: int) -> dict[str, Any]:
        batches = self._db.list_batches(limit=limit)
        return {"total": len(batches), "batches": batches}

    def cleanup(self, days: int) -> dict[str, Any]:
        removed = self._db.cleanup(max_age_days=days)
        return {"removed": removed, "max_age_days": days}

    def create_pending_batch(self, client_ip: str) -> str:
        return self._db.create_pending_batch(client_ip)

    def start_background(self, batch_id: str, raw_requests: list[dict[str, Any]], client_ip: str = "unknown") -> None:
        worker = threading.Thread(target=self._processor.process_batch, args=(batch_id, raw_requests, client_ip), daemon=True)
        worker.start()

    def recover_from_disk(self) -> int:
        return self._db.recover_from_disk()
