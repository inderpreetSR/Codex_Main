"""Run schema upgrades using the migration-only database account."""

# Alembic installs these context proxies when the migration environment runs.
# pylint: disable=no-member

from alembic import context

from app.db import engine

with engine.connect() as connection:
    context.configure(connection=connection)
    with context.begin_transaction():
        context.run_migrations()
