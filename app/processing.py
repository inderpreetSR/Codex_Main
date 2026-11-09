"""Dispatch only predefined job types."""

from app.contracts import AI_JOBS, JobError
from app.db import engine, one
from app.storage import path_for


def dispatch(job):
    """Run the job implementation for its trusted queue type."""
    kind = job["kind"]
    if kind in AI_JOBS:
        from app.generation import generate  # pylint: disable=import-outside-toplevel

        return generate(job)
    if kind == "retrieve":
        from app.rag import retrieve  # pylint: disable=import-outside-toplevel

        return retrieve(job)
    with engine.connect() as connection:
        upload = one(
            connection,
            """
            SELECT id,name,storage_key FROM uploads WHERE id = :id AND project_id = :project
        """,
            id=job["upload_id"],
            project=job["project_id"],
        )
    if upload is None:
        raise JobError("The upload is unavailable.")
    path = path_for(upload["storage_key"])
    if kind == "index":
        from app.rag import index_document  # pylint: disable=import-outside-toplevel

        return index_document(path, upload)
    from app import ml  # pylint: disable=import-outside-toplevel

    frame = ml.read_csv(path)
    if kind == "profile":
        return ml.profile(frame)
    if kind == "preview":
        return ml.preview(frame, job["input"]["features"])
    if kind == "baseline":
        return ml.evaluate(frame, job["input"]["features"], job["input"]["task"])
    raise JobError("Unknown job type.")
