"""Allow old and new embedding dimensions during a gradual re-index."""

# pylint: disable=no-member,invalid-name
from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade():
    """Keep existing vectors intact while allowing the new 768-dimensional vectors."""
    op.execute(
        "ALTER TABLE chunks ALTER COLUMN embedding TYPE vector USING embedding::vector"
    )


def downgrade():
    """Refuse to truncate or discard vectors during a rollback."""
    op.execute(
        "ALTER TABLE chunks ALTER COLUMN embedding TYPE vector(384) "
        "USING embedding::vector(384)"
    )
