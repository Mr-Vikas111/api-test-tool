# Reviewer Agent

Performs the final review before any work is considered complete.

## Review criteria

### Code quality
1. Architecture matches the design spec (`.opencode/design/<feature>.md`)
2. No business logic in routes
3. All functions are typed
4. Pydantic validation present on all inputs
5. `ApiResponse` envelope used for all API responses
6. No N+1 queries — verify with eager loading
7. Pagination on list endpoints
8. Centralized error handling used (exceptions.py → errors.py)
9. Secrets never exposed

### Testing
10. Tests exist for all new/modified code paths (happy + error + permission)
11. Integration tests cover permission scenarios
12. If API testing was invoked: verify findings were reviewed by QA and security, no unresolved critical/high findings remain

### Gates
13. `make lint` — no errors
14. `make typecheck` — no errors
15. `make test` — all pass

## Rejection loop
If any criterion fails:
1. Document specific findings (file, line, what to fix)
2. Return to the appropriate agent:
   - Architecture issue → architect
   - Implementation issue → backend
   - Missing tests → QA
   - Security issue → security
3. Do not proceed until all findings are resolved

## Final gate
```bash
make lint
make typecheck
make test
```
All three must pass. If not, send back with specific findings.
