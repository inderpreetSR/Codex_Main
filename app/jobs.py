"""Durable PostgreSQL queue for offline and outbound AI work."""

import logging
import resource
import sys
from multiprocessing import get_context
from time import monotonic, sleep
from uuid import uuid4

from sqlalchemy.exc import SQLAlchemyError

from app.contracts import AI_JOBS, OFFLINE_JOBS, JobError
from app.db import engine, json_value, one, query
from app.processing import dispatch

LOGGER = logging.getLogger(__name__)
JOB_SECONDS = 150
MAX_ATTEMPTS = 2


def enqueue(connection, project_id, kind, payload=None, upload_id=None):
    """Queue a task within the caller's transaction."""
    return one(
        connection,
        """INSERT INTO jobs (project_id, upload_id, kind, input)
        VALUES (:project, :upload, :kind, CAST(:payload AS jsonb)) RETURNING id""",
        project=project_id,
        upload=upload_id,
        kind=kind,
        payload=json_value(payload or {}),
    )["id"]


def claim(kinds):
    """Claim one job or recover a lease abandoned by a stopped worker."""
    with engine.begin() as connection:
        query(
            connection,
            """
            WITH exhausted AS (
                UPDATE jobs SET status = 'failed', error = 'The worker was interrupted twice.'
                WHERE kind = ANY(:kinds) AND status = 'running'
                AND lease_until <= now() AND attempts >= :max_attempts
                RETURNING upload_id, kind
            )
            UPDATE uploads SET status = 'failed' FROM exhausted
            WHERE uploads.id = exhausted.upload_id AND exhausted.kind IN ('profile', 'index')
        """,
            kinds=list(kinds),
            max_attempts=MAX_ATTEMPTS,
        )
        return one(
            connection,
            """
            WITH candidate AS (
                SELECT id FROM jobs WHERE kind = ANY(:kinds) AND attempts < :max_attempts
                AND (status = 'queued' OR (status = 'running' AND lease_until <= now()))
                ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED
            )
            UPDATE jobs SET status = 'running', attempts = attempts + 1,
                lease_token = :token, lease_until = now() + make_interval(secs => :lease)
            FROM candidate WHERE jobs.id = candidate.id RETURNING jobs.*
        """,
            kinds=list(kinds),
            max_attempts=MAX_ATTEMPTS,
            token=uuid4(),
            lease=JOB_SECONDS + 30,
        )


def process_job(job):
    """Run one task in a subprocess and commit only while its lease is held."""
    started = monotonic()
    try:
        outcome = dispatch(job)
        if outcome is not None:
            finish(job, outcome)
    except JobError as error:
        finish(job, error=str(error))
    except (ValueError, OSError, RuntimeError, SQLAlchemyError):
        LOGGER.error("Job processing error kind=%s", job["kind"])
        finish(job, error="Processing failed. Check the input and retry.")
    finally:
        peak_rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        LOGGER.info(
            "Job kind=%s duration_seconds=%.2f peak_rss_kib=%d",
            job["kind"],
            monotonic() - started,
            peak_rss,
        )


def finish(job, result=None, error=None):
    """Complete the job and update upload metadata in the same transaction."""
    with engine.begin() as connection:
        next_kind = "answer" if result and result.get("answer_pending") else job["kind"]
        next_state = (
            "queued" if next_kind != job["kind"] else "failed" if error else "succeeded"
        )
        completed = one(
            connection,
            """
            UPDATE jobs SET status = :state, result = CAST(:result AS jsonb), error = :error,
            kind = :kind, attempts = CASE WHEN :state = 'queued' THEN 0 ELSE attempts END,
            lease_token = NULL, lease_until = NULL
            WHERE id = :id AND status = 'running' AND lease_token = :token RETURNING id
        """,
            state=next_state,
            result=json_value(result),
            error=error,
            kind=next_kind,
            id=job["id"],
            token=job["lease_token"],
        )
        if completed and job["kind"] in ("profile", "index"):
            query(
                connection,
                """
                UPDATE uploads SET status = :state, profile = CAST(:profile AS jsonb) WHERE id = :id
            """,
                state=next_state,
                profile=json_value(result if job["kind"] == "profile" else None),
                id=job["upload_id"],
            )


def requeue_stale_documents():
    """Schedule a rebuild for previously indexed sources from an older model."""
    from app.retrieval_data import EMBEDDING_REVISION  # pylint: disable=import-outside-toplevel

    with engine.begin() as connection:
        query(
            connection,
            """
            WITH stale AS (
                UPDATE uploads u SET status = 'queued' WHERE u.kind = 'document' AND u.status = 'succeeded'
                AND NOT EXISTS (SELECT 1 FROM chunks c WHERE c.upload_id = u.id AND c.embedding_revision = :revision)
                RETURNING id, project_id
            )
            INSERT INTO jobs (project_id, upload_id, kind)
            SELECT project_id, id, 'index' FROM stale
        """,
            revision=EMBEDDING_REVISION,
        )


def work(kinds):
    """Supervise bounded subprocesses and continue after recoverable errors."""
    context = get_context("spawn")
    refresh_index = kinds == OFFLINE_JOBS
    while True:
        try:
            if refresh_index:
                requeue_stale_documents()
                refresh_index = False
            job = claim(kinds)
            if job is None:
                sleep(1)
                continue
            child = context.Process(target=process_job, args=(job,))
            child.start()
            child.join(JOB_SECONDS)
            if child.is_alive():
                child.kill()
                child.join()
                finish(job, error="The job exceeded its processing time limit.")
            elif child.exitcode:
                finish(job, error="The processing subprocess exited unexpectedly.")
            child.close()
        except SQLAlchemyError:
            LOGGER.error("Worker database unavailable")
            sleep(3)


def main():
    """Start the chosen worker from the container entry point."""
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    work(AI_JOBS if sys.argv[1:] == ["ai"] else OFFLINE_JOBS)
