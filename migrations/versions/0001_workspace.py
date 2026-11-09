"""Create workspace, job, and retrieval tables."""

# Alembic installs the operation proxies while running migrations.
# pylint: disable=no-member,invalid-name

import os

from alembic import op
from sqlalchemy import text

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    """Create the runtime role and application schema."""
    connection = op.get_bind()
    password = os.environ["RUNTIME_DB_PASSWORD"]
    quoted = connection.execute(
        text("SELECT quote_literal(:password)"), {"password": password}
    ).scalar_one()
    if not connection.execute(
        text("SELECT 1 FROM pg_roles WHERE rolname = 'codex_app'")
    ).scalar():
        op.execute(f"CREATE ROLE codex_app LOGIN PASSWORD {quoted}")
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    op.execute("""
        CREATE TABLE projects (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            owner text NOT NULL,
            title text NOT NULL,
            description text NOT NULL,
            task text NOT NULL CHECK (task IN ('classification', 'regression')),
            plan jsonb NOT NULL DEFAULT '{}',
            features jsonb NOT NULL DEFAULT '{}',
            share_private boolean NOT NULL DEFAULT false,
            consent_changed_at timestamptz,
            created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX projects_owner ON projects (owner, created_at DESC);

        CREATE TABLE uploads (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            project_id uuid NOT NULL REFERENCES projects ON DELETE CASCADE,
            name text NOT NULL,
            kind text NOT NULL CHECK (kind IN ('csv', 'document')),
            storage_key uuid NOT NULL UNIQUE,
            status text NOT NULL DEFAULT 'queued',
            profile jsonb,
            created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX uploads_project ON uploads (project_id);

        CREATE TABLE chunks (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            upload_id uuid REFERENCES uploads ON DELETE CASCADE,
            source text NOT NULL,
            location text NOT NULL,
            body text NOT NULL,
            source_chars int NOT NULL,
            embedding vector(384) NOT NULL,
            embedding_revision text NOT NULL
        );
        CREATE INDEX chunks_upload ON chunks (upload_id);

        CREATE TABLE jobs (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            project_id uuid NOT NULL REFERENCES projects ON DELETE CASCADE,
            upload_id uuid REFERENCES uploads ON DELETE CASCADE,
            kind text NOT NULL,
            status text NOT NULL DEFAULT 'queued',
            input jsonb NOT NULL DEFAULT '{}',
            result jsonb,
            error text,
            attempts int NOT NULL DEFAULT 0,
            lease_token uuid,
            lease_until timestamptz,
            created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX jobs_claim ON jobs (kind, status, created_at);
        CREATE INDEX jobs_project ON jobs (project_id, created_at DESC);
        GRANT SELECT, INSERT, UPDATE, DELETE ON projects, uploads, chunks, jobs TO codex_app;
    """)


def downgrade():
    """Remove workspace tables."""
    op.execute("DROP TABLE jobs, chunks, uploads, projects")
