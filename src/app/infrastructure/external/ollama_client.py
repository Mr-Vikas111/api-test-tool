"""Ollama utility functions for listing models and extracting JSON."""

from __future__ import annotations

import json
import re
import urllib.request
from typing import Any

from app.common.config import settings


def _extract_json(text: str) -> Any:
    text = text.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    for pat in (r"```json\s*([\s\S]+?)\s*```", r"```\s*([\s\S]+?)\s*```"):
        m = re.search(pat, text)
        if m:
            try:
                return json.loads(m.group(1))
            except json.JSONDecodeError:
                pass
    for opener, closer in (("[", "]"), ("{", "}")):
        s = text.find(opener)
        e = text.rfind(closer)
        if s != -1 and e != -1 and e > s:
            try:
                return json.loads(text[s:e + 1])
            except json.JSONDecodeError:
                pass
    msg = f"Could not extract JSON from response:\n{text[:600]}"
    raise ValueError(msg)


def _ensure_list(value: Any) -> list[dict]:
    if isinstance(value, list):
        return value
    if isinstance(value, dict):
        for v in value.values():
            if isinstance(v, list):
                return v
    return []


def list_models() -> list[str]:
    base_url = settings.ollama_base_url.rstrip("/")
    req = urllib.request.Request(f"{base_url}/api/tags", method="GET")
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read())
            return [m["name"] for m in data.get("models", [])]
    except Exception:
        return []
