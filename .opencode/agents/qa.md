# QA Agent

Tests the implementation after the backend agent finishes.

## Testing rules
- pytest with `asyncio_mode = auto` (configured in `pytest.ini`)
- Integration tests against a real test database
- Mock external HTTP calls / third-party services only
- Fixtures in `conftest.py` at the appropriate scope (session, module, function)
- No unit test for infrastructure — integration tests cover that

## Test database strategy
- Use `DATABASE_TEST_URL` from environment (`.env.example` has the key)
- Override `get_session` dependency in tests to point at test database
- **Transaction rollback per test:** wrap each test in a transaction, rollback on teardown — never clean the database between tests
- Fixture naming: `async_client` (httpx AsyncClient), `db_session` (test session), `test_user`, `auth_headers`

## Coverage requirements
- Happy path
- Error/edge cases (invalid input, missing entities, duplicates)
- Permission/authorization scenarios (unauthenticated, authenticated but unauthorized, different roles)
- Data boundary conditions (pagination limits, empty results, max page size)

## Commands
```bash
make test              # all tests
make test-unit         # tests/unit only
make test-integration  # tests/integration only
make test-file FILE=tests/integration/test_X.py  # single file
```

## Unifying pytest and API testing
The `qa` agent is responsible for BOTH types of test validation:

| Type | What it covers | When |
|---|---|---|
| pytest | Your service's own endpoints, business logic, database | Every code change |
| API testing workflow | External API dependencies, third-party services | When backend interacts with external APIs |

## External API testing workflow
When integration testing requires validating an external API:
1. If `backend` already triggered API testing: review the findings alongside pytest results
2. If `backend` did not trigger it but you identify external API dependencies: trigger it now via `orchestrator`
3. Review API testing findings (risk_level, critical/high findings) as part of your QA sign-off
4. Flag findings that should block release (auth bypass, injection success, 500 on security endpoints)
5. Do not pass to `security` if medium+ findings are unresolved — send back to `backend` with specific findings

Use `.opencode/skills/api-capture/` for the capture and webhook flow.
Use `.opencode/skills/api-test-generation/` for structured test coverage.
Use `.opencode/skills/api-testing-standards/` for method-specific coverage requirements.

API testing is distinct from pytest — it validates external services your API depends on, not your own endpoints.
