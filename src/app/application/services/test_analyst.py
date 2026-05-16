"""Test Response Analyst Agent — produces AI risk assessment from test results."""

from __future__ import annotations

import json
import logging

from app.application.interfaces.base_agent import BaseOllamaAgent
from app.application.interfaces.llm_adapter import LLMAdapter
from app.application.services.prompt_loader import load_use_case_prompt
from app.infrastructure.external.ollama_client import _extract_json

log = logging.getLogger(__name__)

_JSON_CONTRACT = """\
## Output Contract (runtime automation — must follow exactly)

Return ONLY a valid JSON object. No markdown, no prose, no code fences.

{
    "risk_level": "critical|high|medium|low|clean",
    "summary": "2-3 sentence executive summary of the batch results",
    "findings": [
        {
            "test_name": "exact test name",
            "api": "METHOD /path",
            "severity": "critical|high|medium|low",
            "category": "auth|injection|validation|business_logic|performance|schema|other",
            "issue": "What went wrong in one sentence",
            "root_cause": "Likely technical root cause",
            "remediation": "Concrete actionable fix"
        }
    ],
    "recommendations": ["Top-level action items for the development team (max 5)"],
    "stats": {"total": 0, "passed": 0, "failed": 0, "errors": 0}
}

Severity classification:
- critical: auth bypass success, injection returning 200, 500 on security endpoints
- high: unexpected 500s, IDOR/BOLA exposure, token accepted when it should be rejected
- medium: validation missing, business rule violations, missing error messages
- low: non-critical edge case failures, slow responses, minor schema drift

Risk level = highest severity found across all findings.
If all tests passed -> risk_level = "clean", findings = [].
"""


class TestResponseAnalystAgent(BaseOllamaAgent):
    def __init__(self, model: str, adapter: LLMAdapter | None = None) -> None:
        system = load_use_case_prompt(use_case="analyse", append=_JSON_CONTRACT)
        super().__init__(model, system, adapter)

    def analyse(self, groups: list[dict]) -> dict:
        log.info("[Analyst] Starting risk assessment — %d API group(s)", len(groups))
        total = passed = failed = errors = 0
        failed_cases: list[dict] = []
        for group in groups:
            for r in group.get("test_results", []):
                total += 1
                if r.get("error"):
                    errors += 1
                    failed_cases.append(self._make_finding(group, r, True))
                elif not r.get("passed"):
                    failed += 1
                    failed_cases.append(self._make_finding(group, r, False))
                else:
                    passed += 1

        stats = {"total": total, "passed": passed, "failed": failed, "errors": errors}
        if total == 0:
            return {"risk_level": "clean", "summary": "No test results to analyse.", "findings": [], "recommendations": [], "stats": stats}

        user_msg = (
            "Analyse these API test execution results.\n\n"
            f"Batch statistics: {json.dumps(stats)}\n"
            f"APIs tested: {len(groups)}\n\n"
            f"Failed/errored tests ({len(failed_cases)} of {total}):\n"
            f"{json.dumps(failed_cases[:40], indent=2)}\n\n"
            "Produce a complete risk assessment. Return ONLY the JSON object."
        )
        try:
            content = self._chat(user_msg, temperature=0.2)
            result = _extract_json(content)
            if isinstance(result, dict):
                result.setdefault("stats", stats)
                log.info("[Analyst] Risk assessment complete — risk_level=%s", result.get("risk_level", "?"))
                return result
        except (ValueError, ConnectionError, TimeoutError) as exc:
            log.warning("[Analyst] Could not get AI analysis: %s", exc)

        risk = "clean" if (failed + errors) == 0 else ("high" if (failed + errors) > total * 0.3 else "medium")
        log.info("[Analyst] Returning fallback risk assessment — risk_level=%s", risk)
        return {
            "risk_level": risk, "summary": f"{passed}/{total} tests passed. {failed} failed, {errors} errored.",
            "findings": [], "recommendations": ["Review failed tests manually."], "stats": stats,
        }

    def _make_finding(self, group: dict, r: dict, is_error: bool) -> dict:
        base = {
            "api": group.get("api_request", "?"),
            "test_name": r.get("name", "?"),
            "scenario_description": r.get("scenario_description", ""),
            "request_body_note": r.get("request_body_note", ""),
            "category": r.get("category", "?"),
            "method": r.get("method", "?"),
            "url": r.get("url", "?"),
            "request_payload": r.get("request_payload"),
            "expected_status": r.get("expected_status"),
            "actual_status": r.get("actual_status"),
            "assertion_notes": r.get("assertion_notes", ""),
        }
        if is_error:
            base["error"] = r.get("error")
        else:
            base["failure_suggestion"] = r.get("failure_suggestion", "")
        return base
