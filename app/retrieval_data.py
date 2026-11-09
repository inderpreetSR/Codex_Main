"""PostgreSQL retrieval data shared by the API and workers."""

from uuid import UUID

from app.db import all_rows

EMBEDDING_REVISION = "1110a243fdf4706b3f48f1d95db1a4f5529b4d41"

VISIBLE = """
    FROM chunks c LEFT JOIN uploads u ON u.id = c.upload_id
    WHERE (c.upload_id IS NULL OR (u.project_id = :project AND u.status = 'succeeded'))
"""


def visible_chunks(connection, project_id, ids):
    """Return authorized, still-existing chunks in the requested rank order."""
    if not ids:
        return []
    rows = all_rows(
        connection,
        """
        SELECT c.id, c.upload_id, c.source, c.location, c.body, c.source_chars
    """
        + VISIBLE
        + " AND c.id = ANY(:ids)",
        project=project_id,
        ids=[UUID(value) for value in ids],
    )
    by_id = {str(row["id"]): row for row in rows}
    return [by_id[value] for value in ids if value in by_id]
