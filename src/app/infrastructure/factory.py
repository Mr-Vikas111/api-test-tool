"""Factory pattern for constructing app dependencies with centralized wiring."""

from __future__ import annotations

from app.application.interfaces.llm_adapter import AdapterFactory, LLMAdapter
from app.application.services.webhook_service import BatchProcessor, WebhookFacade
from app.common.config import settings
from app.infrastructure.database import batch_store as store_module


class ServiceFactory:
    @staticmethod
    def create_model(explicit_model: str | None = None) -> str:
        return explicit_model or settings.model_ollama

    @staticmethod
    def create_store() -> store_module.BatchStore:
        return store_module.store

    @staticmethod
    def create_adapter(provider: str | None = None) -> LLMAdapter:
        return AdapterFactory.create(provider or settings.llm_provider)

    @classmethod
    def create_batch_processor(cls, explicit_model: str | None = None, provider: str | None = None) -> BatchProcessor:
        model = cls.create_model(explicit_model)
        adapter = cls.create_adapter(provider)
        return BatchProcessor(db=cls.create_store(), model=model, adapter=adapter)

    @classmethod
    def create_facade(cls, explicit_model: str | None = None, provider: str | None = None) -> WebhookFacade:
        model = cls.create_model(explicit_model)
        processor = cls.create_batch_processor(model, provider)
        return WebhookFacade(db=cls.create_store(), processor=processor, model=model)
