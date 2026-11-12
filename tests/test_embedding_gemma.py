"""Offline Gemma embeddings and mixed-dimension upgrade regression checks."""

from uuid import uuid4

from app.db import engine, query
from app.rag import embedder, ensure_guides, retrieve
from app.retrieval_data import EMBEDDING_REVISION


def test_gemma_dimensions_and_mixed_revision_retrieval():
    """New vectors are 768-D and old vectors remain safe during re-indexing."""
    vector = embedder().embed_query("How do I measure model quality?")
    assert len(vector) == 768
    with engine.begin() as connection:
        ensure_guides(connection)
        old_id = query(
            connection,
            """INSERT INTO chunks
            (source, location, body, source_chars, embedding, embedding_revision)
            VALUES ('Old guide', 'Text', 'Legacy content', 14,
                    CAST(:vector AS vector), 'legacy-384') RETURNING id""",
            vector=str([1.0] + [0.0] * 383),
        ).scalar_one()
    try:
        result = retrieve(
            {
                "project_id": uuid4(),
                "input": {
                    "question": "How do I measure model quality?",
                    "mode": "search",
                },
            }
        )
        assert str(old_id) not in result["ids"]
        with engine.connect() as connection:
            dimensions = query(
                connection,
                "SELECT vector_dims(embedding) FROM chunks "
                "WHERE embedding_revision = :revision LIMIT 1",
                revision=EMBEDDING_REVISION,
            ).scalar_one()
        assert dimensions == 768
    finally:
        with engine.begin() as connection:
            query(connection, "DELETE FROM chunks WHERE id = :id", id=old_id)
