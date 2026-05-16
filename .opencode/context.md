# Project Context

## System goals
- Scalable architecture
- Maintainable code
- Production-grade quality
- Strong security
- Performance optimization

## Project structure
```
src/app/
├── domain/{entity}/         # Domain models, value objects, domain events
├── application/
│   ├── services/            # Business logic (Facade pattern)
│   └── interfaces/          # Abstract interfaces (repo, external services)
├── infrastructure/
│   ├── database/            # SQLAlchemy engine, session, Base
│   ├── repositories/        # Concrete repository implementations
│   └── external/            # External API clients, integrations
├── api/
│   ├── v1/                  # Route modules (one per resource)
│   ├── deps/                # FastAPI dependencies (auth, db session)
│   ├── middleware.py         # RequestID, timing middleware
│   └── errors.py            # Centralized exception → response mapping
└── common/
    ├── exceptions.py        # AppError hierarchy
    ├── response.py          # ApiResponse envelope
    └── logging.py           # structlog JSON config
tests/
├── unit/                    # Pure logic tests (services, domain)
├── integration/             # API + DB tests
└── fixtures/                # Shared test data factories
```

## Module ownership
- `api/v1/` — v1 API routes (webhook, results, batches)
- `api/routes.py` — unversioned routes (health only)
- `api/schemas.py` — Pydantic request/response models for all versions
- `api/errors.py` — centralized FastAPI exception handlers
- `api/middleware.py` — RequestID + timing middleware
- `application/services/` — all business logic (orchestrator, agents, webhook facade)
- `application/interfaces/` — abstract base classes (LLM adapter, base agent)
- `infrastructure/database/` — PostgreSQL connection, batch store
- `infrastructure/external/` — Ollama client, test runner
- `infrastructure/factory.py` — service wiring
- `common/` — shared: config, exceptions, response envelope, logging, sanitize

## Environment
- Python >= 3.11
- Dep manager: `uv` (see `Makefile` for shortcuts)
- Env vars: `.env` at root (never committed); documented in `.env.example`
- Load via `pydantic-settings` `BaseSettings` only; never `os.environ[]` or `print()`/log env values

## Deployment notes
*(Populate when infra is set up — container build, migrations, CI/CD pipeline.)*

## Updating this file
Keep in sync with actual tooling and conventions. If a rule here conflicts with executable config (e.g., `pyproject.toml`, CI scripts), trust the executable source.
