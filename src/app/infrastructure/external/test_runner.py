"""Executes generated test cases against target APIs."""

import logging
import time

import requests

TIMEOUT = 15
log = logging.getLogger(__name__)


def run_one(tc: dict) -> dict:
    name = tc.get("name", "unnamed")
    method = str(tc.get("method", "GET")).upper()
    url = tc.get("url", "")
    log.debug("[Runner] %s %s — %s", method, url, name)
    headers = dict(tc.get("headers") or {})
    payload = tc.get("payload") or {}
    expected_status = int(tc.get("expected_status", 200))
    result = {
        "name": name, "description": tc.get("description", ""),
        "scenario_description": tc.get("scenario_description", ""),
        "request_body_note": tc.get("request_body_note", ""),
        "category": tc.get("category", ""),
        "assertion_notes": tc.get("assertion_notes", ""),
        "failure_suggestion": tc.get("failure_suggestion", ""),
        "method": method, "url": url,
        "request_headers": {k: v for k, v in headers.items() if k.lower() != "authorization"},
        "request_payload": payload if payload else None,
        "model_request": {"method": method, "url": url,
                          "headers": {k: v for k, v in headers.items() if k.lower() != "authorization"},
                          "payload": payload if payload else None},
        "expected_status": expected_status, "actual_status": None,
        "passed": False, "error": None, "duration_ms": None,
    }
    if not url:
        result["error"] = "No URL provided in test case"
        return result
    try:
        start = time.monotonic()
        has_body = method in ("POST", "PUT", "PATCH") and payload
        if has_body:
            resp = requests.request(method, url, headers=headers, json=payload, timeout=TIMEOUT)
        else:
            resp = requests.request(method, url, headers=headers, timeout=TIMEOUT)
        elapsed = round((time.monotonic() - start) * 1000)
        result["actual_status"] = resp.status_code
        result["passed"] = resp.status_code == expected_status
        result["duration_ms"] = elapsed
    except requests.exceptions.ConnectionError as exc:
        log.warning("[Runner] ConnectionError %s %s: %s", method, url, exc)
        result["error"] = f"ConnectionError: {exc}"
    except requests.exceptions.Timeout:
        log.warning("[Runner] Timeout after %ds — %s %s", TIMEOUT, method, url)
        result["error"] = f"Timeout after {TIMEOUT}s"
    except requests.exceptions.RequestException as exc:
        log.warning("[Runner] RequestError %s %s: %s", method, url, exc)
        result["error"] = f"RequestError: {exc}"
    except Exception as exc:
        log.exception("[Runner] Unexpected error %s %s", method, url)
        result["error"] = f"Unexpected error: {exc}"
    return result


def run_all(test_cases: list[dict]) -> list[dict]:
    log.info("[Runner] Running %d test case(s)", len(test_cases))
    return [run_one(tc) for tc in test_cases]


def summarise(results: list[dict]) -> dict:
    passed = sum(1 for r in results if r.get("passed"))
    errors = sum(1 for r in results if r.get("error"))
    failed = len(results) - passed - errors
    return {"total": len(results), "passed": passed, "failed": failed, "errors": errors}
