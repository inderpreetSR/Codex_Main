"""Record administrative actions separately from session events."""

# Alembic installs the operation proxies while running migrations.
# pylint: disable=no-member,invalid-name

from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade():
    """Allow the API to record session termination and read role events."""
    op.execute("""
        CREATE TABLE admin_action_events (
            id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            actor text NOT NULL,
            target text NOT NULL,
            session_id uuid NOT NULL,
            event text NOT NULL CHECK (event = 'session_terminated'),
            created_at timestamptz NOT NULL DEFAULT now()
        );
        GRANT SELECT, INSERT ON admin_action_events TO codex_app;
        GRANT USAGE, SELECT ON SEQUENCE admin_action_events_id_seq TO codex_app;
        GRANT SELECT ON admin_role_events TO codex_app;
    """)


def downgrade():
    """Remove the action records and role event read grant."""
    op.execute("REVOKE SELECT ON admin_role_events FROM codex_app")
    op.execute("DROP TABLE admin_action_events")
