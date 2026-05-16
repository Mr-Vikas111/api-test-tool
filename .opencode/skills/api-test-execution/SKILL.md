# Skill: API Test Execution

Execute or validate the API test workflow by running the app, webhook flow, batch processing, and focused runtime checks.

## When to use
- You need to run the API testing app or validate a webhook/batch flow
- You need to confirm generated tests are being processed
- You need a focused runtime check rather than test design

## Procedure

### 1. Prepare execution context
- Confirm target API is running and reachable
- Identify base URL, auth tokens, any prerequisite state
- Set timeout: 15 seconds per request

### 2. Run each test case
For each test case from `testcase-generator`:
- Send HTTP request matching method, url, headers, payload
- POST/PUT/PATCH with body: send as JSON
- GET/DELETE: send without body
- Compare `actual_status` against `expected_status`

### 3. Capture results
Record per test: name, description, scenario_description, request_body_note, category, method, url, expected_status, actual_status, passed (bool), error (string or null), duration_ms, assertion_notes, failure_suggestion

### 4. Handle errors
| Scenario | Action |
|---|---|
| ConnectionError | `error: "ConnectionError: <details>"` |
| Timeout (>15s) | `error: "Timeout after 15s"` |
| RequestException | `error: "RequestError: <details>"` |
| All pass | Continue |
| Some fail | Log failures |

### 5. Aggregate summary
Compute total/passed/failed/errors across all test cases

### 6. Redact auth from results
Replace Authorization header values with `Bearer <TOKEN>` before storing in results

### 7. Optional: LLM analysis
Attempt LLM-based execution summary; fall back to raw stats if unavailable

### 8. Handoff
Pass structured results to `test-response-analyst` for interpretation
