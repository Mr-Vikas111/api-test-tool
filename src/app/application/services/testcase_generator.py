"""Testcase Generator Agent — generates API test cases using Ollama."""

from __future__ import annotations

import json
import logging

from app.application.interfaces.base_agent import BaseOllamaAgent
from app.application.interfaces.llm_adapter import LLMAdapter
from app.application.services.prompt_loader import load_use_case_prompt
from app.common import sanitize
from app.infrastructure.external.ollama_client import _ensure_list, _extract_json

log = logging.getLogger(__name__)

_JSON_CONTRACT = """\
## Output Contract (runtime automation — must follow exactly)

Return ONLY a valid JSON array. No markdown, no prose, no code fences.
Generate 12-20 test cases.

Each array item must contain EXACTLY these keys:
{
    "name": "concise test name (max 60 chars)",
    "description": "1-2 sentences: what this test validates and why it matters",
    "scenario_description": "1 plain-English sentence — WHAT request is being sent and WHY (written for a non-technical reader)",
    "request_body_note": "Plain-English description of the request body or params used. Write N/A if no body is sent.",
    "category": "one of: happy_path | missing_required | invalid_type | boundary_value | auth_missing | auth_invalid | wrong_method | sql_injection | content_type",
    "method": "HTTP_METHOD",
    "url": "exact full URL from input",
    "headers": {},
    "payload": {},
    "expected_status": 200,
    "assertion_notes": "specific assertions to validate response/business behavior",
    "failure_suggestion": "concrete remediation guidance if test fails"
}

Rules:
- Use exact input URL; do not change host/path.
- Reuse captured payload field names; only mutate values for scenarios.
- For auth_missing: remove authorization header.
- For auth_invalid: use invalid bearer token.
- For sql_injection: ensure expected_status is not 500.
"""


class TestcaseGeneratorAgent(BaseOllamaAgent):
    def __init__(self, model: str, adapter: LLMAdapter | None = None) -> None:
        system = load_use_case_prompt(use_case="generate", append=_JSON_CONTRACT)
        super().__init__(model, system, adapter)

    def generate(self, api_log: dict) -> list[dict]:
        label = f"{api_log.get('method', '?')} {api_log.get('url', '')}"
        log.info("[Generator] Generating test cases for %s", label)
        safe_log = sanitize.sanitize_request(api_log)
        user_msg = (
            "Analyze this captured API request/response carefully and generate test cases.\n\n"
            "CAPTURED API LOG:\n"
            f"{json.dumps(safe_log, indent=2)}\n\n"
            f"Important context from this capture:\n"
            f"- Method: {safe_log.get('method', '?')}\n"
            f"- Status returned: {safe_log.get('status_code', '?')}\n"
            f"- Has auth header: {bool(safe_log.get('headers', {}).get('Authorization'))}\n"
            f"- Has request payload: {bool(safe_log.get('payload'))}\n\n"
            "Return ONLY the JSON array of test cases. No markdown, no explanation."
        )
        content = self._chat(user_msg)
        cases = _ensure_list(_extract_json(content))
        if cases:
            log.info("[Generator] %d test cases generated for %s", len(cases), label)
        else:
            log.warning("[Generator] No test cases returned for %s", label)
        return cases
