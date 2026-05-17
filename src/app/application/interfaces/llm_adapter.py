"""LLM provider adapters — Ollama and OpenAI behind a common interface."""

from __future__ import annotations

import abc
import json
import logging
import socket
import time
import urllib.error
import urllib.request
from typing import Any

from app.common.config import settings

log = logging.getLogger(__name__)


class LLMAdapter(abc.ABC):
    @abc.abstractmethod
    def chat(self, system: str, user: str, model: str, temperature: float = 0.3) -> str:
        ...


class OllamaAdapter(LLMAdapter):
    _RETRIES: int = 3
    _BACKOFF: float = 5.0

    def __init__(self, base_url: str | None = None) -> None:
        self._base_url = (base_url or settings.ollama_base_url).rstrip("/")

    def chat(self, system: str, user: str, model: str, temperature: float = 0.3) -> str:
        log.debug("OllamaAdapter.chat — model=%s temperature=%s user_chars=%d", model, temperature, len(user))
        body = json.dumps({
            "model": model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "stream": False,
            "options": {"temperature": temperature},
        }).encode()

        last_exc: Exception | None = None
        for attempt in range(1, self._RETRIES + 1):
            req = urllib.request.Request(
                f"{self._base_url}/api/chat", data=body,
                headers={"Content-Type": "application/json"}, method="POST",
            )
            try:
                with urllib.request.urlopen(req, timeout=settings.ollama_timeout) as resp:
                    raw = json.loads(resp.read())
                content = raw.get("message", {}).get("content", "")
                log.debug("OllamaAdapter.chat — response received, chars=%d", len(content))
                return content
            except urllib.error.URLError as exc:
                if isinstance(exc.reason, socket.timeout):
                    last_exc = exc
                    wait = self._BACKOFF * attempt
                    log.warning("OllamaAdapter.chat — timeout attempt %d/%d, retry in %.0fs", attempt, self._RETRIES, wait)
                    if attempt < self._RETRIES:
                        time.sleep(wait)
                    continue
                log.exception("OllamaAdapter.chat — connection error: %s", exc)
                msg = f"Cannot reach Ollama at {self._base_url}: {exc}"
                raise ConnectionError(msg) from exc

        msg = (
            f"Ollama timed out after {self._RETRIES} attempts ({settings.ollama_timeout}s each). "
            "Tip: raise OLLAMA_TIMEOUT in .env"
        )
        raise TimeoutError(
            msg
        ) from last_exc


class OpenAIAdapter(LLMAdapter):
    _BASE_URL: str = "https://api.openai.com/v1/chat/completions"

    def __init__(self, api_key: str | None = None) -> None:
        resolved_key = api_key or settings.openai_api_key
        if not resolved_key:
            msg = "OpenAIAdapter requires OPENAI_API_KEY to be set (settings, env var, or api_key= argument)."
            raise ValueError(msg)
        self._api_key = resolved_key
        log.info("OpenAIAdapter initialised")

    def chat(self, system: str, user: str, model: str, temperature: float = 0.3) -> str:
        log.debug("OpenAIAdapter.chat — model=%s temperature=%s user_chars=%d", model, temperature, len(user))
        body = json.dumps({
            "model": model,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
            "temperature": temperature,
        }).encode()
        req = urllib.request.Request(
            self._BASE_URL, data=body,
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {self._api_key}"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=settings.ollama_timeout) as resp:
                raw = json.loads(resp.read())
        except urllib.error.HTTPError as exc:
            body_text = exc.read().decode(errors="replace")
            log.exception("OpenAIAdapter.chat — HTTP %d: %s", exc.code, body_text[:200])
            msg = f"OpenAI API returned HTTP {exc.code}: {body_text}"
            raise RuntimeError(msg) from exc
        except urllib.error.URLError as exc:
            log.exception("OpenAIAdapter.chat — connection error: %s", exc)
            msg = f"Cannot reach OpenAI API: {exc}"
            raise ConnectionError(msg) from exc

        choices = raw.get("choices", [])
        if not choices:
            log.warning("OpenAIAdapter.chat — response had no choices")
            return ""
        return choices[0].get("message", {}).get("content", "")


class AdapterFactory:
    _PROVIDERS: dict[str, type[LLMAdapter]] = {"ollama": OllamaAdapter, "openai": OpenAIAdapter}

    @classmethod
    def create(cls, provider: str | None = None, **kwargs: Any) -> LLMAdapter:
        name = (provider or settings.llm_provider).strip().lower()
        klass = cls._PROVIDERS.get(name)
        if klass is None:
            supported = ", ".join(f"'{p}'" for p in cls._PROVIDERS)
            msg = f"Unknown LLM provider: {name!r}. Supported: {supported}."
            raise ValueError(msg)
        log.info("AdapterFactory — creating adapter for provider=%r", name)
        return klass(**kwargs)
