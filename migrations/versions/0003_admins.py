"""Add locally managed administrator identities."""

# Alembic installs the operation proxies while running migrations.
# pylint: disable=no-member,invalid-name

from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade():
    """Only the migration/administrative DB role can change assignments."""
    op.execute("""
        CREATE TABLE workspace_admins (
            owner text PRIMARY KEY,
            created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE TABLE admin_role_events (
            id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            owner text NOT NULL,
            event text NOT NULL CHECK (event IN ('granted', 'revoked')),
            created_at timestamptz NOT NULL DEFAULT now()
        );
        GRANT SELECT ON workspace_admins TO codex_app;
    """)


def downgrade():
    """Remove local administrator assignments."""
    op.execute("DROP TABLE admin_role_events, workspace_admins")
