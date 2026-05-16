# Skill: API Test Reporting

Analyze API test execution results, summarize risks, explain failures, and recommend fixes. For QA reporting, triage, and response interpretation.

## When to use
- You have test results and need interpretation
- You want failure triage and risk-based prioritization
- You need recommendations after execution

## Procedure

### 1. Read the batch results
- Review batch summary (total/passed/failed/errors)
- Inspect grouped results per API
- Review individual per-test failures and errors

### 2. Separate failure types
- Assertion failure: actual_status != expected_status
- Environment error: ConnectionError, Timeout
- Runtime error: unexpected exception, 500 status

### 3. Classify findings by severity
| Severity | Criteria |
|---|---|
| critical | Auth bypass, injection returning 200, 500 on security endpoints |
| high | Unexpected 500s, IDOR/BOLA, token accepted when it should be rejected |
| medium | Validation missing, business rule violations, missing error messages |
| low | Edge case failures, slow responses, minor schema drift |

### 4. Determine risk level
- `clean` — all tests passed
- `low` — only low-severity findings
- `medium` — medium findings present
- `high` — high findings present
- `critical` — critical findings present

### 5. Produce report
Structure: risk_level, summary, findings array (severity, category, issue, root_cause, remediation), recommendations (max 5), stats
