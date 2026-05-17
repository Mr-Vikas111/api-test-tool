"""Data-layer validation and sanitization for captured API requests."""

from __future__ import annotations

import re
from typing import Any
from urllib.parse import urlparse

VALID_METHODS = {"GET", "POST", "PUT", "PATCH", "DELETE"}

_STATIC_EXTENSIONS_RE = re.compile(
    r"\.(js|jsx|ts|tsx|css|html|htm|ico|png|jpg|jpeg|gif|svg|webp|woff|woff2|ttf|eot|map|gz|zip)$",
    re.IGNORECASE,
)

_SENSITIVE_HEADERS: frozenset[str] = frozenset({
    "authorization", "x-api-key", "x-auth-token", "x-access-token",
    "cookie", "set-cookie", "proxy-authorization",
})

_SENSITIVE_PAYLOAD_KEYS_RE = re.compile(
    r"(password|passwd|secret|token|api_key|apikey|auth|credential|private_key)",
    re.IGNORECASE,
)


class ValidationError(Exception):
    pass


def filter_requests(
    requests_list: list[dict],
) -> tuple[list[dict], dict]:
    if not isinstance(requests_list, list):
        msg = "'requests' must be a list"
        raise ValidationError(msg)

    report: dict[str, Any] = {
        "original": len(requests_list),
        "dropped_no_url": 0, "dropped_bad_method": 0,
        "dropped_static_asset": 0, "dropped_null_status": 0,
        "dropped_duplicate": 0, "kept": 0,
    }
    seen: set[tuple[str, str]] = set()
    clean: list[dict] = []

    for req in requests_list:
        if not isinstance(req, dict):
            report["dropped_no_url"] += 1
            continue
        url = (req.get("url") or "").strip()
        method = (req.get("method") or "").upper().strip()
        status = req.get("status_code")
        if not url or not url.startswith("http"):
            report["dropped_no_url"] += 1
            continue
        if method not in VALID_METHODS:
            report["dropped_bad_method"] += 1
            continue
        try:
            path_only = urlparse(url).path
        except Exception:
            path_only = url
        if _STATIC_EXTENSIONS_RE.search(path_only):
            report["dropped_static_asset"] += 1
            continue
        if status is None:
            report["dropped_null_status"] += 1
            continue
        key = (method, path_only)
        if key in seen:
            report["dropped_duplicate"] += 1
            continue
        seen.add(key)
        clean.append(sanitize_request(req))
        report["kept"] += 1
    return clean, report


def sanitize_request(req: dict) -> dict:
    result = dict(req)
    raw_headers = req.get("headers") or {}
    if isinstance(raw_headers, dict):
        clean_headers: dict[str, str] = {}
        for k, v in raw_headers.items():
            key_lower = k.lower()
            if key_lower == "authorization":
                val_str = str(v)
                if val_str.lower().startswith("bearer "):
                    clean_headers[k] = "Bearer <TOKEN>"
                else:
                    clean_headers[k] = "<REDACTED>"
            elif key_lower in _SENSITIVE_HEADERS:
                clean_headers[k] = "<REDACTED>"
            else:
                clean_headers[k] = v
        result["headers"] = clean_headers
    raw_payload = req.get("payload")
    if isinstance(raw_payload, dict):
        result["payload"] = _redact_dict(raw_payload)
    return result


def _redact_dict(d: dict, _depth: int = 0) -> dict:
    if _depth > 5:
        return d
    out: dict = {}
    for k, v in d.items():
        if _SENSITIVE_PAYLOAD_KEYS_RE.search(str(k)):
            out[k] = "<REDACTED>"
        elif isinstance(v, dict):
            out[k] = _redact_dict(v, _depth + 1)
        elif isinstance(v, list):
            out[k] = [_redact_dict(item, _depth + 1) if isinstance(item, dict) else item for item in v]
        else:
            out[k] = v
    return out
