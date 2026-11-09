"""Add revocable application sessions and minimal audit events."""

# Alembic installs the operation proxies while running migrations.
# pylint: disable=no-member,invalid-name

from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade():
    """Create session storage and grant the runtime role access."""
    op.execute("""
        CREATE TABLE app_sessions (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            secret_hash text NOT NULL UNIQUE,
            owner text NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            last_activity timestamptz NOT NULL DEFAULT now(),
            ended_at timestamptz
        );
        CREATE INDEX app_sessions_owner ON app_sessions (owner, created_at DESC);
        CREATE TABLE session_events (
            id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            session_id uuid REFERENCES app_sessions(id) ON DELETE SET NULL,
            owner text NOT NULL,
            event text NOT NULL CHECK (event IN ('started', 'signed_out', 'expired')),
            created_at timestamptz NOT NULL DEFAULT now()
        );
        GRANT SELECT, INSERT, UPDATE ON app_sessions TO codex_app;
        GRANT SELECT, INSERT ON session_events TO codex_app;
        GRANT USAGE, SELECT ON SEQUENCE session_events_id_seq TO codex_app;
    """)


def downgrade():
    """Remove the session tables."""
    op.execute("DROP TABLE session_events, app_sessions")
