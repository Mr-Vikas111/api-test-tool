# API Testing Standards per HTTP Method

## Overview
Every generated test suite must cover the method-specific patterns below. Tests must be ordered by severity: security > auth > validation > happy path. Generate 12-20 tests total per API endpoint.

## GET — Read/Query Operations

| # | Category | Test | Expected |
|---|----------|------|----------|
| 1 | happy_path | Valid request with expected response | 200 |
| 2 | happy_path | Request with valid query parameters | 200 |
| 3 | invalid_type | Invalid query parameter values | 400/422 |
| 4 | boundary_value | Extremely large/small query values | 400/422 |
| 5 | missing_required | Missing required query parameter | 400/422 |
| 6 | missing_required | Empty query parameters | 200 with empty array/default |
| 7 | auth_missing | Request without auth token | 401 |
| 8 | auth_invalid | Request with invalid/expired token | 401 |
| 9 | wrong_method | POST/PUT/DELETE on read endpoint | 405 |
| 10 | sql_injection | SQL injection in query string | 400/422 (never 500) |
| 11 | content_type | XSS payload in query parameter | 400/422 or sanitized |
| 12 | happy_path | Pagination (page, limit parameters) | 200 with correct structure |

Extended: filtering, sorting, large dataset response time, ETag caching, rate limit headers

## POST — Create Operations

| # | Category | Test | Expected |
|---|----------|------|----------|
| 1 | happy_path | Valid payload creates resource | 201 |
| 2 | happy_path | Response includes resource ID and Location header | 201 |
| 3 | missing_required | Missing all required fields | 400/422 |
| 4 | missing_required | Missing a single required field | 400/422 |
| 5 | invalid_type | Wrong data type for a field | 400/422 |
| 6 | invalid_type | Invalid enum value | 400/422 |
| 7 | boundary_value | Empty string in required field | 400/422 |
| 8 | boundary_value | Very large payload (>1MB) | 413 or 400 |
| 9 | auth_missing | No auth token | 401 |
| 10 | auth_invalid | Invalid/expired token | 401 |
| 11 | wrong_method | GET/PUT on create endpoint | 405 |
| 12 | sql_injection | SQL injection in string fields | 400/422 (never 500) |
| 13 | content_type | Wrong Content-Type | 415 or 400 |
| 14 | happy_path | Duplicate submission (idempotency) | 409 or 200 |

Extended: nested object validation, file upload, business rule violations, concurrent duplicates

## PUT — Full Update Operations

| # | Category | Test | Expected |
|---|----------|------|----------|
| 1 | happy_path | Complete valid replacement | 200 |
| 2 | missing_required | Missing fields required for full update | 400/422 |
| 3 | invalid_type | Wrong data types in body | 400/422 |
| 4 | invalid_type | Invalid entity ID format | 400 or 404 |
| 5 | missing_required | Non-existent resource ID | 404 |
| 6 | boundary_value | Empty body | 400/422 |
| 7 | auth_missing | No auth token | 401 |
| 8 | auth_invalid | Invalid token | 401 |
| 9 | wrong_method | GET/DELETE on update endpoint | 405 |
| 10 | happy_path | Idempotency — same PUT twice | 200 both times |
| 11 | sql_injection | Injection in updatable fields | 400/422 |
| 12 | content_type | Immutable fields rejected | 400/422 or silently ignored |

Extended: partial update rejection, optimistic locking (409), cascading updates

## PATCH — Partial Update Operations

| # | Category | Test | Expected |
|---|----------|------|----------|
| 1 | happy_path | Update single field | 200 |
| 2 | happy_path | Update multiple fields | 200 |
| 3 | boundary_value | Empty patch body | 400/422 |
| 4 | invalid_type | Invalid field name | 400/422 |
| 5 | invalid_type | Wrong data type for patched field | 400/422 |
| 6 | missing_required | Non-existent entity ID | 404 |
| 7 | auth_missing | No auth token | 401 |
| 8 | auth_invalid | Invalid token | 401 |
| 9 | wrong_method | PUT/DELETE on partial update endpoint | 405 |
| 10 | sql_injection | Injection in patched field | 400/422 |
| 11 | content_type | Setting field to null | 200 or 400 |

Extended: concurrent patch conflicts (409), read-only fields, nested object partial update

## DELETE — Remove Operations

| # | Category | Test | Expected |
|---|----------|------|----------|
| 1 | happy_path | Valid delete returns confirmation | 200/204 |
| 2 | happy_path | Resource no longer accessible after delete | 404 |
| 3 | missing_required | Non-existent resource ID | 404 |
| 4 | boundary_value | Invalid ID format | 400 or 404 |
| 5 | auth_missing | No auth token | 401 |
| 6 | auth_invalid | Invalid token | 401 |
| 7 | wrong_method | POST/PUT on delete endpoint | 405 |
| 8 | happy_path | Double delete (idempotent) | 404 |
| 9 | sql_injection | Injection in ID parameter | 400/404 (never 500) |
| 10 | content_type | Delete with dependency | 409 or 200 |

Extended: soft vs hard delete, role-based access, bulk delete, cleanup verification

## Cross-Method Requirements (apply to ALL methods)
- **Auth**: always include `auth_missing` and `auth_invalid` unless endpoint is public
- **Wrong method**: at least one wrong-method test
- **Injection**: SQL injection on every string input (expected_status must NOT be 500)
- **Schema**: response body schema validation on happy path
- **Error shape**: error responses must return structured JSON (not HTML or plain text)
- **CORS**: preflight OPTIONS returns correct headers
