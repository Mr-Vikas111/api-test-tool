"""Unit tests for the sanitization module."""

from __future__ import annotations

from typing import Any

import pytest

from app.common.sanitize import (
    ValidationError,
    filter_requests,
    sanitize_request,
)


class TestFilterRequests:
    def test_empty_list_returns_empty(self) -> None:
        result, report = filter_requests([])
        assert result == []
        assert report["original"] == 0

    def test_filters_valid_requests(self) -> None:
        requests: list[dict[str, Any]] = [
            {"method": "GET", "url": "https://api.example.com/users", "status_code": 200},
        ]
        result, report = filter_requests(requests)
        assert len(result) == 1
        assert result[0]["method"] == "GET"
        assert report["kept"] == 1

    def test_drops_request_without_url(self) -> None:
        requests: list[dict[str, Any]] = [
            {"method": "GET", "status_code": 200},
            {"method": "GET", "url": "", "status_code": 200},
        ]
        result, report = filter_requests(requests)
        assert len(result) == 0
        assert report["dropped_no_url"] == 2

    def test_drops_bad_method(self) -> None:
        requests: list[dict[str, Any]] = [
            {"method": "OPTIONS", "url": "https://api.example.com/test", "status_code": 200},
        ]
        result, report = filter_requests(requests)
        assert len(result) == 0
        assert report["dropped_bad_method"] == 1

    def test_drops_static_asset(self) -> None:
        requests: list[dict[str, Any]] = [
            {"method": "GET", "url": "https://example.com/image.png", "status_code": 200},
        ]
        result, report = filter_requests(requests)
        assert len(result) == 0
        assert report["dropped_static_asset"] == 1

    def test_drops_null_status(self) -> None:
        requests: list[dict[str, Any]] = [
            {"method": "GET", "url": "https://api.example.com/test"},
        ]
        result, report = filter_requests(requests)
        assert len(result) == 0
        assert report["dropped_null_status"] == 1

    def test_drops_duplicates(self) -> None:
        requests: list[dict[str, Any]] = [
            {"method": "GET", "url": "https://api.example.com/users", "status_code": 200},
            {"method": "GET", "url": "https://api.example.com/users", "status_code": 200},
        ]
        result, report = filter_requests(requests)
        assert len(result) == 1
        assert report["dropped_duplicate"] == 1

    def test_raises_on_non_list(self) -> None:
        with pytest.raises(ValidationError, match="'requests' must be a list"):
            filter_requests("not a list")  # type: ignore[arg-type]


class TestSanitizeRequest:
    def test_redacts_authorization_bearer(self) -> None:
        req: dict[str, Any] = {
            "method": "GET",
            "url": "https://api.example.com/users",
            "headers": {"Authorization": "Bearer secret-token-12345"},
        }
        result = sanitize_request(req)
        assert result["headers"]["Authorization"] == "Bearer <TOKEN>"

    def test_redacts_other_sensitive_headers(self) -> None:
        req: dict[str, Any] = {
            "method": "GET",
            "url": "https://api.example.com/users",
            "headers": {"x-api-key": "super-secret-key"},
        }
        result = sanitize_request(req)
        assert result["headers"]["x-api-key"] == "<REDACTED>"

    def test_redacts_password_in_payload(self) -> None:
        req: dict[str, Any] = {
            "method": "POST",
            "url": "https://api.example.com/login",
            "payload": {"username": "admin", "password": "hunter2"},
        }
        result = sanitize_request(req)
        assert result["payload"]["password"] == "<REDACTED>"  # noqa: S105
        assert result["payload"]["username"] == "admin"

    def test_keeps_regular_headers(self) -> None:
        req: dict[str, Any] = {
            "method": "GET",
            "url": "https://api.example.com/users",
            "headers": {"Content-Type": "application/json"},
        }
        result = sanitize_request(req)
        assert result["headers"]["Content-Type"] == "application/json"
