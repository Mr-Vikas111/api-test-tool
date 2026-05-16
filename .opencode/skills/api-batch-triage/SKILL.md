# Skill: API Batch Triage

Inspect stored API batch results end to end, summarize execution health, classify risks, and recommend next actions. For batch triage, failed run analysis, and QA status reporting.

## When to use
- You have a stored batch ID and need an end-to-end summary
- A webhook run completed with mixed pass/fail/error results
- You need to combine execution facts with QA and risk analysis
- You want a concise status report for a generated API testing batch

## Procedure

### 1. Identify the batch source
- Stored batch ID
- `GET /results/{batch_id}` payload
- Copied result summary

### 2. Read the batch data
- Summary: status, total/passed/failed/errors, risk_level
- Progress: done/total
- Grouped results per API request
- Per-test details for failures

### 3. Separate findings
- Passed validations — note what works
- Assertion failures — actual vs expected status mismatch
- Environment/runtime errors — timeouts, connection refused
- Likely flaky or dependency-driven failures — intermittent issues

### 4. Classify issues
Group by severity and business impact using the standard severity scale (critical → high → medium → low)

### 5. Recommend next action
- Regenerate tests (if test cases were incorrect)
- Rerun execution (if environmental failures)
- Fix backend behavior (if assertion failures indicate bugs)
- Inspect auth, schema, validation, or rate limiting logic

### 6. Produce triage summary
Output: batch overview, execution health, high-severity findings, likely root causes, recommended next actions, residual risks
