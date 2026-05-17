"""Integration tests for the webhook → batch → results pipeline."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import create_application


@pytest.fixture
def app():
    with patch("app.infrastructure.factory.store_module") as m, \
         patch("app.infrastructure.database.connection.init_db"), \
         patch("app.infrastructure.database.connection.execute", return_value=[]), \
         patch("app.infrastructure.database.connection.execute_many"):

        m.store = MagicMock()
        m.store.create_pending_batch.return_value = "test-batch-123"
        m.store.get.return_value = None
        m.store.get_from_disk.return_value = None
        m.store.list_batches.return_value = []
        m.STATUS_PENDING = "pending"
        m.STATUS_RUNNING = "running"
        m.STATUS_DONE = "done"
        m.STATUS_ERROR = "error"

        yield create_application()


@pytest.fixture
async def client(app):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


class TestWebhook:
    async def test_health_endpoint(self, client: AsyncClient) -> None:
        resp = await client.get("/health")
        assert resp.status_code == 200
        assert resp.json()["status"] == "ok"

    async def test_webhook_empty_requests_returns_400(self, client: AsyncClient) -> None:
        resp = await client.post("/api/v1/webhook", json={"requests": []})
        assert resp.status_code == 400

    async def test_webhook_invalid_payload_returns_422(self, client: AsyncClient) -> None:
        resp = await client.post("/api/v1/webhook", json={})
        assert resp.status_code == 422

    async def test_webhook_accepts_valid_payload(self, client: AsyncClient) -> None:
        payload = {"requests": [{"method": "GET", "url": "https://api.example.com/users", "headers": {}, "payload": None}]}
        resp = await client.post("/api/v1/webhook", json=payload)
        assert resp.status_code == 200
        body = resp.json()
        assert body["success"] is True
        assert body["data"]["batch_id"] == "test-batch-123"

    async def test_list_batches_returns_list(self, client: AsyncClient) -> None:
        resp = await client.get("/api/v1/batches")
        assert resp.status_code == 200
        body = resp.json()
        assert body["success"] is True
        assert isinstance(body["data"]["batches"], list)

    async def test_unknown_batch_returns_404(self, client: AsyncClient) -> None:
        resp = await client.get("/api/v1/results/nonexistent")
        assert resp.status_code == 404
        body = resp.json()
        assert body["success"] is False
        assert body["error"]["code"] == "NOT_FOUND"
