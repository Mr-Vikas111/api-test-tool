"""Agent Orchestrator — coordinates Testcase Generator, Test Executor, and Analyst."""

from __future__ import annotations

import logging
from typing import Any

from app.application.services.test_analyst import TestResponseAnalystAgent
from app.application.services.test_executor import TestExecutorAgent
from app.application.services.testcase_generator import TestcaseGeneratorAgent
from app.application.interfaces.llm_adapter import AdapterFactory, LLMAdapter
from app.infrastructure.database import batch_store as store_module

log = logging.getLogger(__name__)


class AgentOrchestrator:
    def __init__(self, model: str, db: store_module.BatchStore, adapter: LLMAdapter | None = None) -> None:
        self._db = db
        _adapter = adapter if adapter is not None else AdapterFactory.create()
        self._generator = TestcaseGeneratorAgent(model, _adapter)
        self._executor = TestExecutorAgent(model, _adapter)
        self._analyst = TestResponseAnalystAgent(model, _adapter)

    def run_batch(self, batch_id: str, requests_list: list[dict[str, Any]]) -> None:
        n = len(requests_list)
        log.info("[Orchestrator] Batch %s started — %d API(s) to process", batch_id, n)
        self._db.set_status(batch_id, status=store_module.STATUS_RUNNING, message=f"[Orchestrator] Starting pipeline... (0/{n} APIs)")

        all_passed = all_failed = all_errors = 0
        groups: list[dict[str, Any]] = []

        for i, api_log in enumerate(requests_list):
            label = f"{api_log.get('method', '?')} {api_log.get('url', '')}"

            log.info("[Orchestrator] Stage 1 — generating tests for %s (%d/%d)", label, i + 1, n)
            self._db.set_status(batch_id, message=f"[Generator] Generating tests for {label} ({i + 1}/{n})...")
            try:
                test_cases = self._generator.generate(api_log)
            except ConnectionError as exc:
                log.error("[Orchestrator] Stage 1 connection error for %s: %s", label, exc)
                self._db.set_status(batch_id, status=store_module.STATUS_ERROR, message=str(exc), error=str(exc))
                self._db.finalise(batch_id)
                return
            except Exception as exc:
                log.exception("[Orchestrator] Stage 1 unexpected error for %s", label)
                groups.append({"api_request": label, "generated": 0, "test_results": [], "error": f"Generator error: {exc}"})
                self._db.set_status(batch_id, groups=groups)
                continue

            if not test_cases:
                groups.append({"api_request": label, "generated": 0, "test_results": [], "error": "Generator returned no test cases"})
                self._db.set_status(batch_id, groups=groups)
                continue

            log.info("[Orchestrator] Stage 2 — executing %d tests for %s", len(test_cases), label)
            self._db.set_status(batch_id, message=f"[Executor] Running {len(test_cases)} tests for {label}...")
            exec_result = self._executor.execute(test_cases)
            tc_results = exec_result.get("results", [])
            summary = {"total": exec_result.get("total", 0), "passed": exec_result.get("passed", 0),
                       "failed": exec_result.get("failed", 0), "errors": exec_result.get("errors", 0)}

            all_passed += summary["passed"]
            all_failed += summary["failed"]
            all_errors += summary["errors"]

            groups.append({"api_request": label, "generated": len(test_cases), "test_results": tc_results, "summary": summary})
            self._db.set_status(batch_id, groups=groups,
                                summary={"total": all_passed + all_failed + all_errors, "passed": all_passed, "failed": all_failed, "errors": all_errors},
                                progress={"done": i + 1, "total": n})

        self._db.set_status(batch_id, message="[Analyst] Running AI risk assessment...")
        try:
            ai_analysis = self._analyst.analyse(groups)
        except Exception as exc:
            log.exception("[Orchestrator] Stage 3 analyst error: %s", exc)
            ai_analysis = {"risk_level": "unknown", "error": str(exc)}

        log.info("[Orchestrator] Batch %s complete — passed=%d failed=%d errors=%d risk=%s",
                 batch_id, all_passed, all_failed, all_errors, ai_analysis.get("risk_level", "?"))
        self._db.set_status(
            batch_id, status=store_module.STATUS_DONE,
            message=f"Done — {all_passed} passed, {all_failed} failed, {all_errors} errors | risk: {ai_analysis.get('risk_level', '?')}",
            ai_analysis=ai_analysis,
        )
        self._db.finalise(batch_id)
