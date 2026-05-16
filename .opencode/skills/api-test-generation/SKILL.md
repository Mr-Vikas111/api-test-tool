# Skill: API Test Generation

Generate enterprise API test cases from captured requests, cURL, HAR, browser logs, sample responses, or API docs. Apply for functional, negative, validation, auth, and security coverage.

## When to use
- You need enterprise-grade test scenarios for an API endpoint
- You want functional, negative, auth, validation, boundary, and security coverage
- You are using captured browser logs or webhook input as the starting point

## Procedure

### 1. Read the API context
- Method, URL, headers, payload, query params, response status and body
- Identify endpoint purpose, auth model, and validation assumptions

### 2. Sanitize the input
- Redact Authorization tokens, API keys, passwords, secrets before processing
- Replace `Bearer <token>` with `Bearer <TOKEN>`
- Replace sensitive payload values with `<REDACTED>`

### 3. Generate prioritized coverage
Cover across these categories in order of severity:
1. Security (injection, auth bypass)
2. Authorization (auth_missing, auth_invalid)
3. Validation (missing_required, invalid_type, boundary_value)
4. Happy path (valid request, edge cases)
5. Method handling (wrong_method)
6. Content negotiation (content_type)

### 4. Structure each test case
Each test must include: name, description, scenario_description, request_body_note, category, method, url, headers, payload, expected_status, assertion_notes, failure_suggestion

### 5. Output
Return structured test cases ready for the `test-executor` agent to run directly.
