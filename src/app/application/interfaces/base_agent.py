"""Base agent with pluggable LLM adapter."""

from __future__ import annotations

import logging

from app.application.interfaces.llm_adapter import AdapterFactory, LLMAdapter

log = logging.getLogger(__name__)


class BaseOllamaAgent:
    def __init__(self, model: str, system_prompt: str, adapter: LLMAdapter | None = None) -> None:
        self.model = model
        self._system = system_prompt
        self._adapter: LLMAdapter = adapter if adapter is not None else AdapterFactory.create()
        log.debug("%s initialised — model=%s adapter=%s", self.__class__.__name__, model, type(self._adapter).__name__)

    def _chat(self, user_message: str, temperature: float = 0.3) -> str:
        log.debug("%s._chat — model=%s adapter=%s temperature=%s", self.__class__.__name__, self.model, type(self._adapter).__name__, temperature)
        return self._adapter.chat(self._system, user_message, self.model, temperature)


BaseAgent = BaseOllamaAgent
