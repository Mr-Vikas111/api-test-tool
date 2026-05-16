# AGENTS.md

## Stack
- **Framework:** FastAPI
- **Database:** PostgreSQL (async SQLAlchemy)
- **Validation:** Pydantic
- **Testing:** pytest
- **Lint:** ruff
- **Typecheck:** mypy
- **Dep Manager:** uv
- **Logging:** structlog (JSON)

## Project structure
```
src/app/
├── domain/{entity}/         # models, value objects, domain events
├── application/
│   ├── services/            # webhook_service, orchestrator_service, testcase_generator, etc.
│   └── interfaces/          # llm_adapter, base_agent
├── infrastructure/
│   ├── database/            # connection (psycopg2), batch_store
│   ├── external/            # ollama_client, test_runner
│   └── factory.py           # service wiring
├── api/
│   ├── routes.py            # webhook, results, batches endpoints
│   ├── schemas.py           # WebhookPayload, HealthResponse
│   ├── middleware.py         # RequestID, timing
│   └── errors.py            # centralized exception handlers
└── common/
    ├── config.py            # pydantic-settings
    ├── exceptions.py        # AppError hierarchy
    ├── response.py          # ApiResponse envelope
    ├── sanitize.py          # credential redaction
    └── logging.py           # structlog JSON
webhook_server.py             # entrypoint
tests/
├── unit/
├── integration/
├── fixtures/
└── conftest.py
```

## Commands
| Command | Action |
|---|---|
| `make dev` | Start dev server (uvicorn, hot-reload) |
| `make install` | Install dependencies via uv |
| `make lint` | ruff check . |
| `make typecheck` | mypy . |
| `make test` | pytest (all) |
| `make test-unit` | pytest tests/unit |
| `make test-integration` | pytest tests/integration |
| `make migrate-create M="msg"` | alembic autogenerate revision |
| `make migrate-up` | alembic upgrade head |
| `make migrate-down` | alembic downgrade -1 |
| `make format` | ruff format . |

**Required order before finalizing:** `make lint` → `make typecheck` → `make test`

## Architecture
- Clean architecture with repository pattern + service layer
- OOP design patterns: Service (Facade), Strategy, Factory, Template Method (BaseRepository), Builder, Domain Events, Value Objects
- Routes are thin — business logic never lives there
- Async-first throughout
- Centralized exception handling via FastAPI handlers (`exceptions.py` → `errors.py`)
- Structured JSON logging with structlog, request ID propagation

## Key conventions
- Strict typing everywhere; avoid `Any` unless unavoidable
- Always paginate list APIs (`page`, `per_page`, `total` in MetaInfo)
- Avoid N+1 queries — use eager loading / selectinload
- Proper transaction handling with `async with db.session.begin()`
- Small reusable functions, SOLID, no duplicate logic
- Explicit over implicit

## API contracts
- **Error envelope:** `{"success": false, "error": {"code": str, "message": str, "details": ...}}`
- **Success envelope:** `{"success": true, "data": ..., "meta": {"page": int, "per_page": int, "total": int}}`
- **Versioning:** all business endpoints under `/api/v1/` prefix; health at `/health` (unversioned)
- Middleware order: RequestID → Timing → CORS → Auth → Route
- Healthcheck at `GET /health`

## Security (non-negotiable)
- Validate auth on every protected endpoint
- Validate authorization — never assume, prevent privilege escalation
- Validate all input via Pydantic
- Never expose secrets, never hardcode
- Never commit `.env` or credential files — verify `.gitignore` covers them
- Load env via `pydantic-settings`; never `os.environ[]` in app code
- Follow OWASP top 10

## Testing rules
- pytest with `asyncio_mode = auto`
- Integration tests against a real test database
- Cover: happy path, edge cases, permission scenarios
- Mock external HTTP/services only

## Available agents & workflow

### Decision flow
Every request enters through `analysis` which routes to the correct path:

```
User Request
    │
    ▼
┌────────────┐
│  analysis   │  ← determines request type: code change, API validation, or both
└─────┬──────┘
      │
      ├── Code change only ────────────────────────────────────────────┐
      │                                                                ▼
      │                                                    ┌──────────────┐
      │                                                    │  architect   │  →
      │                                                    └──────────────┘
      │                                                          │
      │                                                     backend
      │                                                          │
      │                                                    ┌─────┴──────┐
      │                                                    │ Needs      │
      │                                                    │ external   │── No ──► QA ──► Security ──► Reviewer
      │                                                    │ API test?  │
      │                                                    └─────┬──────┘
      │                                                       Yes │
      │                                                            ▼
      │                                                     API Test Flow
      │                                                     [orchestrator → generator →
      │                                                      executor → analyst] → results
      │                                                            │
      │                                                            ▼
      │                                                     QA (pytest + API findings review)
      │                                                            │
      │                                                            ▼
      │                                                     Security (code audit + API audit)
      │                                                            │
      │                                                            ▼
      │                                                     Reviewer (final gate)
      │
      ├── API validation only ──► orchestrator → generator → executor → analyst (standalone)
      │
      └── Both ──► architect → backend → [embedded API test] → QA → Security → Reviewer
```

### Build workflow (application development)
```
analysis → architect → backend → [optional API test] → QA → Security → Reviewer
```

| Step | Agent | Deliverable |
|---|---|---|
| Intake | `analysis` | Request classification and routing decision |
| Design | `architect` | `.opencode/design/<feature>.md` with endpoints, models, interfaces, ADRs |
| Implement | `backend` | Working code following the design spec |
| API test | *(embedded)* | `orchestrator` → generator → executor → analyst, when backend has external API dependencies |
| Test | `qa` | pytest complete + API testing findings reviewed |
| Audit | `security` | Security checklist verified (code + API results) |
| Gate | `reviewer` | Lint + typecheck + test all pass, no open findings |

**Rejection loop:** If security or reviewer finds issues, return to prior agent with specific findings. No work is complete until all gates pass.

### API testing workflow (standalone)
```
analysis → orchestrator → generator → executor → analyst
```

| Step | Agent | Deliverable |
|---|---|---|
| Intake | `analysis` | Request classification |
| Coordinate | `orchestrator` | Pipeline execution, error handling, result aggregation |
| Generate | `testcase-generator` | 12-20 structured test cases per API |
| Execute | `test-executor` | Pass/fail/error results with timing |
| Analyze | `test-response-analyst` | Risk assessment with severity findings and remediation |

**Use when:** validating external APIs, no code changes needed. Results are consumed directly by the requester (any agent).

## Execution protocol
Analyze → plan (architecture decisions explained) → implement → review modified files → run validate commands.

Never:
- Business logic in routes
- Skip validation, typing, or tests
- Write unsafe queries
- Ignore failed checks

## See also
- `.opencode/context.md` — extended project context
- `.opencode/agents/` — per-agent specialization instructions
- `.opencode/skills/` — repeatable workflow procedures (api-test-generation, api-test-execution, api-test-reporting, api-batch-triage, api-testing-standards, api-capture)
