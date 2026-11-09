"""Database connections and parameterized query helpers."""

import json
import os

from sqlalchemy import URL, create_engine, text

engine = create_engine(
    URL.create(
        "postgresql+psycopg",
        username=os.getenv("DB_USER", "codex_app"),
        password=os.getenv("DB_PASSWORD"),
        host=os.getenv("DB_HOST", "db"),
        database=os.getenv("DB_NAME", "codex"),
    ),
    pool_pre_ping=True,
    hide_parameters=True,
)


def query(connection, statement, **params):
    """Execute a parameterized SQL statement."""
    return connection.execute(text(statement), params)


def one(connection, statement, **params):
    """Read one row as a dictionary."""
    row = query(connection, statement, **params).mappings().first()
    return dict(row) if row is not None else None


def all_rows(connection, statement, **params):
    """Read rows as dictionaries."""
    return [dict(row) for row in query(connection, statement, **params).mappings()]


def json_value(value):
    """Serialize a value for a PostgreSQL JSONB parameter."""
    return json.dumps(value, allow_nan=False)
