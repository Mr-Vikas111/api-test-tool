"""PostgreSQL-backed storage manager for captured API batches."""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from app.infrastructure.database import connection as db

STATUS_PENDING = "pending"
STATUS_RUNNING = "running"
STATUS_DONE = "done"
STATUS_ERROR = "error"


def _new_batch_id() -> str:
    return uuid.uuid4().hex[:16]


def _parse_json(val: Any) -> Any:
    if val is None:
        return None
    if isinstance(val, (dict, list)):
        return val
    try:
        return json.loads(val)
    except (TypeError, json.JSONDecodeError):
        return val


class BatchStore:
    def create_batch(self, body: dict, requests_list: list[dict], filter_report: dict, client_ip: str = "unknown") -> str:
        batch_id = _new_batch_id()
        created_at = datetime.now(tz=timezone.utc).isoformat()
        db.execute(
            "INSERT INTO batches (id, status, message, client_ip, created_at, filter_report, total_requests, progress_done, progress_total) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, 0, %s)",
            (batch_id, STATUS_PENDING, "Queued - starting shortly...", client_ip, created_at,
             json.dumps(filter_report), len(requests_list), len(requests_list)),
        )
        request_rows = [
            (batch_id, seq, (r.get("method") or "?").upper(), r.get("url", ""),
             json.dumps(r.get("headers")), json.dumps(r.get("payload")), r.get("status_code"))
            for seq, r in enumerate(requests_list)
        ]
        db.execute_many(
            "INSERT INTO requests (batch_id, seq, method, url, headers, payload, status_code) VALUES (%s, %s, %s, %s, %s::jsonb, %s::jsonb, %s)",
            request_rows,
        )
        return batch_id

    def create_pending_batch(self, client_ip: str = "unknown") -> str:
        batch_id = _new_batch_id()
        created_at = datetime.now(tz=timezone.utc).isoformat()
        db.execute(
            "INSERT INTO batches (id, status, message, client_ip, created_at) VALUES (%s, %s, %s, %s, %s)",
            (batch_id, STATUS_PENDING, "Received — validating...", client_ip, created_at),
        )
        return batch_id

    def store_validated_requests(self, batch_id: str, requests_list: list[dict], filter_report: dict | None = None) -> None:
        db.execute(
            "UPDATE batches SET status = %s, message = %s, filter_report = %s::jsonb, total_requests = %s, progress_done = 0, progress_total = %s WHERE id = %s",
            (STATUS_RUNNING, f"Processing {len(requests_list)} request(s)...",
             json.dumps(filter_report or {}), len(requests_list), len(requests_list), batch_id),
        )
        request_rows = [
            (batch_id, seq, (r.get("method") or "?").upper(), r.get("url", ""),
             json.dumps(r.get("headers")), json.dumps(r.get("payload")), r.get("status_code"))
            for seq, r in enumerate(requests_list)
        ]
        db.execute_many(
            "INSERT INTO requests (batch_id, seq, method, url, headers, payload, status_code) VALUES (%s, %s, %s, %s, %s::jsonb, %s::jsonb, %s)",
            request_rows,
        )

    def set_status(self, batch_id: str, **fields) -> None:
        sets: list[str] = []
        params: list[Any] = []
        for key, val in fields.items():
            if key == "progress":
                sets.append("progress_done = %s, progress_total = %s")
                params.extend([val.get("done", 0), val.get("total", 0)])
            elif key == "summary":
                sets.append("passed = %s, failed = %s, errors = %s")
                params.extend([val.get("passed", 0), val.get("failed", 0), val.get("errors", 0)])
            elif key in ("filter", "filter_report", "ai_analysis", "groups"):
                col = "filter_report" if key == "filter" else key
                sets.append(f"{col} = %s::jsonb")
                params.append(json.dumps(val))
            elif key == "error":
                sets.append("message = %s")
                params.append(str(val))
            else:
                sets.append(f"{key} = %s")
                params.append(val)
        if sets:
            params.append(batch_id)
            db.execute(f"UPDATE batches SET {', '.join(sets)} WHERE id = %s", tuple(params))

    def get(self, batch_id: str) -> dict | None:
        rows = db.execute(
            "SELECT id, status, message, client_ip, created_at::TEXT, completed_at::TEXT, "
            "filter_report, ai_analysis, total_requests, passed, failed, errors, progress_done, progress_total "
            "FROM batches WHERE id = %s", (batch_id,),
        )
        if not rows:
            return None
        r = rows[0]
        return {
            "batch_id": r["id"], "status": r["status"], "message": r["message"],
            "client_ip": r["client_ip"], "created_at": r["created_at"], "completed_at": r["completed_at"],
            "filter": _parse_json(r.get("filter_report")),
            "ai_analysis": _parse_json(r.get("ai_analysis")),
            "summary": {"total": r["total_requests"], "passed": r["passed"], "failed": r["failed"], "errors": r["errors"]},
            "progress": {"done": r["progress_done"], "total": r["progress_total"]},
            "groups": self._get_groups(batch_id),
        }

    def _get_groups(self, batch_id: str) -> list[dict]:
        rows = db.execute(
            "SELECT request_seq, api_request, generated, total, passed, failed, errors "
            "FROM request_groups WHERE batch_id = %s ORDER BY request_seq", (batch_id,),
        )
        groups = []
        for r in rows:
            tr_rows = db.execute(
                "SELECT name, description, scenario_description, request_body_note, category, method, url, "
                "expected_status, actual_status, passed, error, duration_ms, assertion_notes, failure_suggestion, "
                "request_headers, request_payload "
                "FROM test_results WHERE batch_id = %s AND request_seq = %s ORDER BY id",
                (batch_id, r["request_seq"]),
            )
            test_results = []
            for t in tr_rows:
                result = dict(t)
                result["request_headers"] = _parse_json(result.get("request_headers"))
                result["request_payload"] = _parse_json(result.get("request_payload"))
                test_results.append(result)
            groups.append({
                "api_request": r["api_request"], "generated": r["generated"],
                "test_results": test_results,
                "summary": {"total": r["total"], "passed": r["passed"], "failed": r["failed"], "errors": r["errors"]},
            })
        return groups

    def get_from_disk(self, batch_id: str) -> dict | None:
        return None

    def get_requests(self, batch_id: str) -> list[dict]:
        rows = db.execute(
            "SELECT seq, method, url, headers, payload, status_code FROM requests WHERE batch_id = %s ORDER BY seq",
            (batch_id,),
        )
        return [{"seq": r["seq"], "method": r["method"], "url": r["url"],
                  "headers": _parse_json(r.get("headers")), "payload": _parse_json(r.get("payload")),
                  "status_code": r.get("status_code")} for r in rows]

    def get_request(self, batch_id: str, seq: int) -> dict | None:
        rows = db.execute(
            "SELECT seq, method, url, headers, payload, status_code FROM requests WHERE batch_id = %s AND seq = %s",
            (batch_id, seq),
        )
        if not rows:
            return None
        r = rows[0]
        return {"seq": r["seq"], "method": r["method"], "url": r["url"],
                "headers": _parse_json(r.get("headers")), "payload": _parse_json(r.get("payload")),
                "status_code": r.get("status_code")}

    def get_request_results(self, batch_id: str, seq: int) -> dict | None:
        request_info = self.get_request(batch_id, seq)
        if request_info is None:
            return None
        tc_rows = db.execute(
            "SELECT * FROM test_cases WHERE batch_id = %s AND request_seq = %s ORDER BY id",
            (batch_id, seq),
        )
        tr_rows = db.execute(
            "SELECT * FROM test_results WHERE batch_id = %s AND request_seq = %s ORDER BY id",
            (batch_id, seq),
        )
        group_rows = db.execute(
            "SELECT * FROM request_groups WHERE batch_id = %s AND request_seq = %s",
            (batch_id, seq),
        )
        return {
            "request": request_info,
            "test_cases": [dict(r) for r in tc_rows],
            "test_results": [dict(r) for r in tr_rows],
            "group": dict(group_rows[0]) if group_rows else None,
        }

    def finalise(self, batch_id: str) -> None:
        now = datetime.now(tz=timezone.utc).isoformat()
        db.execute(
            "UPDATE batches SET status = %s, completed_at = %s WHERE id = %s AND status IN (%s, %s)",
            (STATUS_DONE, now, batch_id, STATUS_RUNNING, STATUS_PENDING),
        )

    def list_batches(self, limit: int = 100) -> list[dict]:
        rows = db.execute(
            "SELECT id, status, client_ip, created_at::TEXT, completed_at::TEXT, "
            "total_requests, passed, failed, errors, progress_done, progress_total "
            "FROM batches ORDER BY created_at DESC LIMIT %s", (limit,),
        )
        return [{"batch_id": r["id"], "status": r["status"], "client_ip": r["client_ip"],
                  "created_at": r["created_at"], "completed_at": r["completed_at"],
                  "total": r["total_requests"],
                  "progress": {"done": r["progress_done"], "total": r["progress_total"]},
                  "summary": {"total": r["total_requests"], "passed": r["passed"], "failed": r["failed"], "errors": r["errors"]}} for r in rows]

    def cleanup(self, max_age_days: int = 7) -> int:
        cutoff = datetime.now(tz=timezone.utc) - timedelta(days=max_age_days)
        rows = db.execute("DELETE FROM batches WHERE created_at < %s RETURNING id", (cutoff.isoformat(),))
        return len(rows)

    def batch_dir(self, batch_id: str) -> str:
        return ""

    def store_test_cases(self, batch_id: str, request_seq: int, test_cases: list[dict]) -> None:
        rows = [
            (batch_id, request_seq, tc.get("name", ""), tc.get("description"),
             tc.get("scenario_description"), tc.get("request_body_note"), tc.get("category"),
             (tc.get("method") or "GET").upper(), tc.get("url", ""),
             json.dumps(tc.get("headers")), json.dumps(tc.get("payload")),
             tc.get("expected_status"), tc.get("assertion_notes"), tc.get("failure_suggestion"))
            for tc in test_cases
        ]
        db.execute_many(
            "INSERT INTO test_cases (batch_id, request_seq, name, description, scenario_description, "
            "request_body_note, category, method, url, headers, payload, expected_status, assertion_notes, failure_suggestion) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s::jsonb, %s, %s, %s)", rows,
        )

    def store_test_results(self, batch_id: str, request_seq: int, results: list[dict]) -> None:
        rows = [
            (batch_id, request_seq, r.get("name"), r.get("description"),
             r.get("scenario_description"), r.get("request_body_note"), r.get("category"),
             r.get("method"), r.get("url"), r.get("expected_status"), r.get("actual_status"),
             r.get("passed", False), r.get("error"), r.get("duration_ms"),
             r.get("assertion_notes"), r.get("failure_suggestion"),
             json.dumps(r.get("request_headers")), json.dumps(r.get("request_payload")))
            for r in results
        ]
        db.execute_many(
            "INSERT INTO test_results (batch_id, request_seq, name, description, scenario_description, "
            "request_body_note, category, method, url, expected_status, actual_status, "
            "passed, error, duration_ms, assertion_notes, failure_suggestion, request_headers, request_payload) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s::jsonb)", rows,
        )

    def store_groups(self, batch_id: str, groups: list[dict]) -> None:
        rows = [
            (batch_id, i, g.get("api_request", ""), g.get("generated", 0),
             (g.get("summary") or {}).get("total", 0),
             (g.get("summary") or {}).get("passed", 0),
             (g.get("summary") or {}).get("failed", 0),
             (g.get("summary") or {}).get("errors", 0))
            for i, g in enumerate(groups)
        ]
        db.execute_many(
            "INSERT INTO request_groups (batch_id, request_seq, api_request, generated, total, passed, failed, errors) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s) ON CONFLICT DO NOTHING", rows,
        )

    def recover_from_disk(self) -> int:
        return 0


store = BatchStore()
