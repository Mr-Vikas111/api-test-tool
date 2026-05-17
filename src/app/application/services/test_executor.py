"""Test Executor Agent — runs generated test cases and analyzes results."""

from __future__ import annotations

import json
import logging
from typing import Any

from app.application.interfaces.base_agent import BaseOllamaAgent
from app.application.interfaces.llm_adapter import LLMAdapter
from app.application.services.prompt_loader import load_use_case_prompt
from app.infrastructure.external import test_runner
from app.infrastructure.external.ollama_client import _extract_json

log = logging.getLogger(__name__)

_JSON_CONTRACT = """\
## Output Contract (runtime automation — must follow exactly)

Return ONLY a valid JSON object. No markdown, no prose, no code fences.

{
    "execution_summary": "2-3 sentence summary of what was executed and the results",
    "total": 0,
    "passed": 0,
    "failed": 0,
    "errors": 0,
    "results": [
        {
            "name": "exact test name",
            "description": "test description",
            "category": "test category",
            "method": "HTTP_METHOD",
            "url": "full URL",
            "expected_status": 200,
            "actual_status": 200,
            "passed": true,
            "error": null,
            "duration_ms": 150,
            "assertion_notes": "specific assertions validated",
            "failure_suggestion": "remediation guidance if test fails"
        }
    ],
    "failures": [
        {"test_name": "name of failing test", "reason": "what went wrong — expected vs actual or error message"}
    ],
    "blockers": ["list of environmental or systemic blocking issues"],
    "next_step": "suggested next debugging or execution step"
}
"""


class TestExecutorAgent(BaseOllamaAgent):
    def __init__(self, model: str, adapter: LLMAdapter | None = None) -> None:
        system = load_use_case_prompt(use_case="execute", append=_JSON_CONTRACT)
        super().__init__(model, system, adapter)

    def execute(self, test_cases: list[dict]) -> dict[str, Any]:
        n = len(test_cases)
        log.info("[Executor] Executing %d test case(s)", n)
        results = test_runner.run_all(test_cases)
        summary = test_runner.summarise(results)
        failures = [
            {"test_name": r.get("name", "?"),
             "reason": r.get("error") or f"Expected {r.get('expected_status')}, got {r.get('actual_status')}"}
            for r in results if not r.get("passed")
        ]
        try:
            result = self._llm_analyse(summary, results, failures)
        except Exception:
            log.warning("[Executor] LLM analysis unavailable, using fallback")
            result = self._fallback(summary, results, failures)
        log.info("[Executor] Complete — passed=%d failed=%d errors=%d", summary["passed"], summary["failed"], summary["errors"])
        return result

    def _llm_analyse(self, summary: dict, results: list[dict], failures: list[dict]) -> dict[str, Any]:
        user_msg = (
            "Summarise these API test execution results.\n\n"
            f"Statistics: {json.dumps(summary)}\n"
            f"Failures ({len(failures)} of {summary['total']}):\n"
            f"{json.dumps(failures[:40], indent=2)}\n\n"
            "Produce a structured execution report. Return ONLY the JSON object."
        )
        content = self._chat(user_msg, temperature=0.2)
        parsed = _extract_json(content)
        if isinstance(parsed, dict):
            parsed.setdefault("results", results)
            return parsed
        msg = "LLM did not return a valid object"
        raise ValueError(msg)

    def _fallback(self, summary: dict, results: list[dict], failures: list[dict]) -> dict[str, Any]:
        return {
            "execution_summary": f"Executed {summary['total']} test(s) — {summary['passed']} passed, {summary['failed']} failed, {summary['errors']} errored",
            "total": summary["total"], "passed": summary["passed"], "failed": summary["failed"], "errors": summary["errors"],
            "results": results, "failures": failures, "blockers": [],
            "next_step": "Review failures and re-run or inspect backend" if failures else "All tests passed",
        }
