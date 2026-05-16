from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class WebhookPayload(BaseModel):
    requests: list[dict[str, Any]] = Field(default_factory=list)


class HealthResponse(BaseModel):
    status: str
    server: str
    ollama_model: str
    ollama_models: list[str]
    storage: str
