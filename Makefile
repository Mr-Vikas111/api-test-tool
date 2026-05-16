.PHONY: dev install lint typecheck test test-unit test-integration test-file migrate-create migrate-up migrate-down clean

# Dependency manager: uv
install:
	pip install -r requirements.txt

dev:
	./scripts/start.sh

dev-install:
	./scripts/start.sh --install

# Quality
lint:
	ruff check .

typecheck:
	mypy .

lint-fix:
	ruff check . --fix

format:
	ruff format .

# Testing
test:
	pytest

test-unit:
	pytest tests/unit -xvs

test-integration:
	pytest tests/integration -xvs

test-file:
	pytest $(FILE) -xvs

# Database
migrate-create:
	alembic revision --autogenerate -m "$(M)"

migrate-up:
	alembic upgrade head

migrate-down:
	alembic downgrade -1

# Cleanup
clean:
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
	find . -type f -name '*.pyc' -delete
