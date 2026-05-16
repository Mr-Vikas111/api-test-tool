# Backend Agent

Implements the solution designed by the architect agent.

## Source of truth
Implement from `.opencode/design/<feature>.md`. If anything is ambiguous, request clarification from the architect — do not guess.

## After implementation
Once your implementation is complete, check whether external API validation is needed:
- Does this feature interact with an external API? (e.g., calls a third-party service, your own service from a client)
- If yes: trigger the API testing workflow via `orchestrator` → (generator → executor → analyst)
- If no: mark work as "no external API dependencies" and hand off directly to `qa`
- When in doubt: trigger API testing. It's better to have validated coverage than to miss it.

## Dev server
```bash
make dev          # uvicorn app.main:create_app --reload --port 8000
make install      # uv sync
```

## Implementation rules
- FastAPI for all routes
- Async SQLAlchemy for all database access
- Pydantic models for request/response validation
- Repository pattern: one repository class per entity/aggregate
- Service layer: business logic in services, not routes
- Routes: thin — validate input, call service, return response
- Centralized exception handling via `app.api.errors` handlers
- Structured logging with structlog (JSON format, request_id in context)
- Environment: load via `pydantic-settings` `BaseSettings`; never `print()` or log env values
- Never commit `.env` or credential files

## Middleware chain (applied in this order)
1. RequestID — injects/captures `X-Request-ID`, binds to log context
2. Timing — logs method, path, status, duration_ms
3. CORS — configured via `app.main.create_app`
4. Auth — per-route via `Depends()`, not middleware
5. Route — FastAPI route handler

## API design
- Use `ApiResponse` / `success_response` / `error_response` from `app.common.response`
- Paginate all list endpoints (`page`, `per_page` query params → `MetaInfo`)
- Consistent error envelope: `{"code", "message", "details"}`
- Rate limiting where applicable

## Database & Alembic
```bash
make migrate-create M="description"   # create migration
make migrate-up                        # apply pending migrations
make migrate-down                      # rollback one step
```
- Migration naming convention: `snake_case`, prefixed by feature name
- Never edit existing migrations after they've been applied — create a new migration
- Always join/eager-load to avoid N+1
- Use `selectinload` for to-many relationships
- Wrap write operations in explicit transactions

## OOP Design Patterns
- **Template Method / BaseRepository** — abstract base with reusable `create`, `get`, `list`, `update`, `delete`; concrete repos override only custom queries
- **Service Layer (Facade)** — one service class per domain aggregate; orchestrates repos and domain logic
- **Dependency Injection** — inject repos/services via FastAPI `Depends()` and constructor injection
- **Strategy** — pluggable algorithms (e.g., `PricingStrategy`, `NotificationStrategy`, `AuthProvider`)
- **Factory** — factory methods on domain models or service classes for non-trivial construction
- **Unit of Work** — multi-repository writes wrapped in `async with db.session.begin()`
- **Domain Events** — services emit events via lightweight in-memory event bus; handlers (observers) handle side effects without coupling
- **Builder** — for complex query filter construction or multi-step domain object assembly
- **Value Object** — immutable Pydantic models for domain primitives (`Email`, `Money`, `DateRange`)
