"""PostgreSQL connection manager and schema migrations."""

from __future__ import annotations

import logging
import threading
from typing import Any

from psycopg2 import pool
from psycopg2.extras import RealDictCursor

from app.common.config import settings

log = logging.getLogger(__name__)

_pool: pool.ThreadedConnectionPool | None = None
_pool_lock = threading.Lock()


def _get_pool() -> pool.ThreadedConnectionPool:
    global _pool
    if _pool is None:
        with _pool_lock:
            if _pool is None:
                _pool = pool.ThreadedConnectionPool(minconn=1, maxconn=10, dsn=settings.database_url)
    return _pool


def get_connection():
    return _get_pool().getconn()


def put_connection(conn):
    _get_pool().putconn(conn)


def execute(query: str, params: tuple | None = None) -> list[dict[str, Any]]:
    conn = get_connection()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(query, params)
            if cur.description:
                rows = [dict(row) for row in cur.fetchall()]
                conn.commit()
                return rows
            conn.commit()
            return []
    except Exception:
        conn.rollback()
        raise
    finally:
        put_connection(conn)


def execute_many(query: str, params_list: list[tuple]) -> None:
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.executemany(query, params_list)
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        put_connection(conn)


SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS batches (
    id              TEXT PRIMARY KEY,
    status          TEXT NOT NULL DEFAULT 'pending',
    message         TEXT,
    client_ip       TEXT,
    created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    completed_at    TIMESTAMP WITH TIME ZONE,
    filter_report   JSONB,
    ai_analysis     JSONB,
    groups          JSONB,
    total_requests  INTEGER NOT NULL DEFAULT 0,
    passed          INTEGER NOT NULL DEFAULT 0,
    failed          INTEGER NOT NULL DEFAULT 0,
    errors          INTEGER NOT NULL DEFAULT 0,
    progress_done   INTEGER NOT NULL DEFAULT 0,
    progress_total  INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS requests (
    id          SERIAL PRIMARY KEY,
    batch_id    TEXT NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
    seq         INTEGER NOT NULL,
    method      TEXT NOT NULL,
    url         TEXT NOT NULL,
    headers     JSONB,
    payload     JSONB,
    status_code INTEGER,
    created_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE(batch_id, seq)
);
CREATE TABLE IF NOT EXISTS test_cases (
    id                  SERIAL PRIMARY KEY,
    batch_id            TEXT NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
    request_seq         INTEGER NOT NULL,
    name                TEXT NOT NULL,
    description         TEXT,
    scenario_description TEXT,
    request_body_note   TEXT,
    category            TEXT,
    method              TEXT NOT NULL,
    url                 TEXT NOT NULL,
    headers             JSONB,
    payload             JSONB,
    expected_status     INTEGER,
    assertion_notes     TEXT,
    failure_suggestion  TEXT,
    created_at          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS test_results (
    id                  SERIAL PRIMARY KEY,
    batch_id            TEXT NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
    request_seq         INTEGER NOT NULL,
    name                TEXT,
    description         TEXT,
    scenario_description TEXT,
    request_body_note   TEXT,
    category            TEXT,
    method              TEXT,
    url                 TEXT,
    expected_status     INTEGER,
    actual_status       INTEGER,
    passed              BOOLEAN NOT NULL DEFAULT FALSE,
    error               TEXT,
    duration_ms         INTEGER,
    assertion_notes     TEXT,
    failure_suggestion  TEXT,
    request_headers     JSONB,
    request_payload     JSONB,
    executed_at         TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS request_groups (
    id          SERIAL PRIMARY KEY,
    batch_id    TEXT NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
    request_seq INTEGER NOT NULL,
    api_request TEXT NOT NULL,
    generated   INTEGER NOT NULL DEFAULT 0,
    total       INTEGER NOT NULL DEFAULT 0,
    passed      INTEGER NOT NULL DEFAULT 0,
    failed      INTEGER NOT NULL DEFAULT 0,
    errors      INTEGER NOT NULL DEFAULT 0,
    UNIQUE(batch_id, request_seq)
);
CREATE INDEX IF NOT EXISTS idx_requests_batch ON requests(batch_id, seq);
CREATE INDEX IF NOT EXISTS idx_test_cases_batch ON test_cases(batch_id, request_seq);
CREATE INDEX IF NOT EXISTS idx_test_results_batch ON test_results(batch_id, request_seq);
CREATE INDEX IF NOT EXISTS idx_batches_status ON batches(status);
CREATE INDEX IF NOT EXISTS idx_batches_created ON batches(created_at);
"""

MIGRATIONS_SQL = ["ALTER TABLE batches ADD COLUMN IF NOT EXISTS groups JSONB"]


def init_db() -> None:
    log.info("Initialising database schema...")
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(SCHEMA_SQL)
            for migration in MIGRATIONS_SQL:
                try:
                    cur.execute(migration)
                except Exception:
                    conn.rollback()
                    conn.commit()
                    conn = get_connection()
                    cur = conn.cursor()
        conn.commit()
        log.info("Database schema initialised.")
    except Exception:
        conn.rollback()
        log.exception("Failed to initialise database schema")
        raise
    finally:
        put_connection(conn)
