"""Unit tests for the test_runner module."""

from __future__ import annotations

from typing import Any
from unittest.mock import patch

from app.infrastructure.external.test_runner import run_all, run_one, summarise


class TestRunOne:
    def test_missing_url_returns_error(self) -> None:
        tc: dict[str, Any] = {"name": "test", "method": "GET", "url": ""}
        result = run_one(tc)
        assert result["error"] == "No URL provided in test case"
        assert result["passed"] is False

    def test_successful_request(self) -> None:
        tc: dict[str, Any] = {
            "name": "test-get",
            "method": "GET",
            "url": "https://api.example.com/users",
            "expected_status": 200,
        }
        with patch("requests.request") as mock_request:
            mock_response = mock_request.return_value
            mock_response.status_code = 200
            result = run_one(tc)
        assert result["passed"] is True
        assert result["actual_status"] == 200
        assert result["name"] == "test-get"
        assert "duration_ms" in result

    def test_failed_request_wrong_status(self) -> None:
        tc: dict[str, Any] = {
            "name": "test-get",
            "method": "GET",
            "url": "https://api.example.com/users",
            "expected_status": 200,
        }
        with patch("requests.request") as mock_request:
            mock_response = mock_request.return_value
            mock_response.status_code = 404
            result = run_one(tc)
        assert result["passed"] is False
        assert result["actual_status"] == 404

    def test_connection_error(self) -> None:
        tc: dict[str, Any] = {
            "name": "test-connection",
            "method": "GET",
            "url": "https://api.example.com/nonexistent",
        }
        with patch("requests.request", side_effect=__import__("requests").exceptions.ConnectionError("connection refused")):  # noqa: E501
            result = run_one(tc)
        assert result["passed"] is False
        assert "ConnectionError" in (result["error"] or "")

    def test_timeout_error(self) -> None:
        tc: dict[str, Any] = {
            "name": "test-timeout",
            "method": "GET",
            "url": "https://api.example.com/slow",
        }
        with patch("requests.request", side_effect=__import__("requests").exceptions.Timeout):
            result = run_one(tc)
        assert result["passed"] is False
        assert "Timeout" in (result["error"] or "")

    def test_strips_authorization_from_request_headers(self) -> None:
        tc: dict[str, Any] = {
            "name": "test-auth",
            "method": "GET",
            "url": "https://api.example.com/secure",
            "headers": {"Authorization": "Bearer token123", "Content-Type": "application/json"},
        }
        with patch("requests.request") as mock_request:
            mock_response = mock_request.return_value
            mock_response.status_code = 200
            result = run_one(tc)
        assert "Authorization" not in result["request_headers"]
        assert result["request_headers"]["Content-Type"] == "application/json"


class TestRunAll:
    def test_runs_multiple_cases(self) -> None:
        test_cases: list[dict[str, Any]] = [
            {"name": "test-1", "method": "GET", "url": "https://api.example.com/a", "expected_status": 200},
            {"name": "test-2", "method": "POST", "url": "https://api.example.com/b", "expected_status": 201},
        ]
        with patch("app.infrastructure.external.test_runner.run_one") as mock_run_one:
            mock_run_one.side_effect = [
                {"name": "test-1", "passed": True, "actual_status": 200, "duration_ms": 50},
                {"name": "test-2", "passed": True, "actual_status": 201, "duration_ms": 60},
            ]
            results = run_all(test_cases)
        assert len(results) == 2
        assert mock_run_one.call_count == 2


class TestSummarise:
    def test_all_passed(self) -> None:
        results: list[dict[str, Any]] = [
            {"passed": True},
            {"passed": True},
            {"passed": True},
        ]
        summary = summarise(results)
        assert summary["total"] == 3
        assert summary["passed"] == 3
        assert summary["failed"] == 0
        assert summary["errors"] == 0

    def test_mixed_results(self) -> None:
        results: list[dict[str, Any]] = [
            {"passed": True},
            {"passed": False, "error": None},
            {"passed": False, "error": "Connection error"},
        ]
        summary = summarise(results)
        assert summary["total"] == 3
        assert summary["passed"] == 1
        assert summary["failed"] == 1
        assert summary["errors"] == 1
