# Skill: API Capture

Capture API traffic from browser or tools, validate, sanitize, and submit for test generation.

## Prerequisites
- Chrome extension (or any tool that captures request/response pairs)
- Target API must be reachable
- Webhook endpoint at `POST /webhook`

## Capture flow
1. Browser extension captures request/response pairs from network traffic
2. Extension submits captured payload to `POST /webhook`
3. Server validates and sanitizes the batch
4. Background processing starts: generate tests → execute → analyze

## Webhook payload format
```json
{
  "requests": [
    {
      "url": "http://target-api.example.com/api/resource",
      "method": "GET",
      "headers": {"Authorization": "Bearer ...", "Accept": "application/json"},
      "payload": {},
      "response": [{"id": 1, "text": "demo"}],
      "status_code": 200
    }
  ]
}
```

## Validation rules (applied in order)
Each captured request must pass all checks:

| Rule | Condition | Drop reason |
|------|-----------|-------------|
| Valid URL | Must be non-empty, starting with `http` | `dropped_no_url` |
| Supported method | One of: GET, POST, PUT, PATCH, DELETE | `dropped_bad_method` |
| Not static asset | URL path must not end with `.js`, `.css`, `.png`, `.svg`, `.ico`, fonts, etc. | `dropped_static_asset` |
| Completed response | `status_code` must not be null | `dropped_null_status` |
| Not duplicate | Deduplicate by (METHOD, path-without-query) | `dropped_duplicate` |

## Credential redaction rules
Before storing or processing, redact sensitive values:

| Location | Pattern | Replacement |
|----------|---------|-------------|
| Authorization header | `Bearer <token>` | `Bearer <TOKEN>` |
| Sensitive header names | authorization, x-api-key, x-auth-token, cookie, set-cookie, proxy-authorization | `<REDACTED>` |
| Payload keys matching | password, passwd, secret, token, api_key, apikey, auth, credential, private_key | `<REDACTED>` |
| Nested payload objects | Recursively redact up to 5 levels deep | `<REDACTED>` |

## Batch lifecycle
1. **POST /webhook** → creates batch with status `pending`
2. Validation → status `running`, stores sanitized requests
3. Pipeline processing → updates progress (done/total)
4. Completion → status `done`, results available via `GET /results/{batch_id}`
5. Error → status `error`, message explains failure

## Batch storage model
- `batches`: id, status, message, client_ip, created_at, completed_at, filter_report, ai_analysis, total_requests, passed, failed, errors, progress_done, progress_total
- `requests`: batch_id, seq, method, url, headers, payload, status_code
- `test_cases`: batch_id, request_seq, name, description, category, method, url, headers, payload, expected_status, assertion_notes, failure_suggestion
- `test_results`: batch_id, request_seq, name, expected_status, actual_status, passed, error, duration_ms, assertion_notes, failure_suggestion
- `request_groups`: batch_id, request_seq, api_request, generated, total, passed, failed, errors

## Webhook response
```json
{
  "ok": true,
  "batch_id": "a1b2c3d4e5f67890",
  "results_url": "http://host/results/a1b2c3d4e5f67890",
  "total": 1,
  "filter": {"original": 1, "dropped_no_url": 0, "dropped_bad_method": 0, "dropped_static_asset": 0, "dropped_null_status": 0, "dropped_duplicate": 0, "kept": 1},
  "methods": {"GET": 1}
}
```
