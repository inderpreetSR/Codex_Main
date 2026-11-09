"""Loopback FastAPI interface for the data science workspace."""

import hashlib
import os
from pathlib import Path
from typing import Annotated, Literal
from uuid import UUID, uuid4

from fastapi import (
    APIRouter,
    Depends,
    FastAPI,
    File,
    Header,
    HTTPException,
    Request,
    UploadFile,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response

from app.auth import check_session, create_session, current_owner, verified_owner
from app.contracts import (
    Approval,
    Consent,
    DatasetJob,
    Features,
    JobOutput,
    Plan,
    ProjectInput,
    ProjectOutput,
    Question,
    UploadJob,
    UploadOutput,
)
from app.db import all_rows, engine, json_value, one, query
from app.guides import GUIDES
from app.jobs import enqueue
from app.storage import UPLOAD_LIMIT, path_for

app = FastAPI(title="Codex Main API", version="1.0.0")


@app.middleware("http")
async def limit_upload_body(request: Request, call_next):
    """Reject oversized multipart requests before the framework spools them."""
    if request.method == "POST" and request.url.path.rstrip("/").endswith("/uploads"):
        length = request.headers.get("content-length")
        if length is None:
            return JSONResponse(
                {"detail": "Uploads must include a Content-Length."}, status_code=411
            )
        if not length.isdecimal() or len(length) > 10:
            return JSONResponse({"detail": "Invalid upload length."}, status_code=400)
        if int(length) > UPLOAD_LIMIT + 128 * 1024:
            return JSONResponse(
                {"detail": "Uploads are limited to 10 MB."}, status_code=413
            )
    return await call_next(request)


app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:8080"],
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Authorization", "Content-Type", "X-Workspace-Session"],
)
api = APIRouter(prefix="/api/v1")
Owner = Annotated[str, Depends(current_owner)]


def require_admin(owner: Owner):
    """Authorize the verified identity against the server-managed role table."""
    with engine.connect() as connection:
        admin = one(
            connection,
            "SELECT owner FROM workspace_admins WHERE owner = :owner",
            owner=owner,
        )
    if admin is None:
        raise HTTPException(403, "Administrator access required.")
    return owner


@api.get("/account")
def account(owner: Owner):
    """Expose only the caller's own administrator status."""
    with engine.connect() as connection:
        admin = one(
            connection,
            "SELECT owner FROM workspace_admins WHERE owner = :owner",
            owner=owner,
        )
    return {"is_admin": admin is not None}


@api.get("/admin/overview")
def admin_overview(_admin: Annotated[str, Depends(require_admin)]):
    """Show aggregate operational counts without returning private project data."""
    with engine.connect() as connection:
        return one(
            connection,
            """SELECT
            (SELECT count(*) FROM projects) AS projects,
            (SELECT count(*) FROM app_sessions WHERE ended_at IS NULL
                AND last_activity > now() - interval '30 minutes'
                AND created_at > now() - interval '12 hours') AS active_sessions,
            (SELECT count(*) FROM session_events WHERE created_at >= now() - interval '24 hours') AS session_events_24h,
            (SELECT count(*) FROM jobs WHERE status IN ('queued', 'running')) AS active_jobs""",
        )


@api.get("/admin/users")
def admin_users(_admin: Annotated[str, Depends(require_admin)]):
    """List recently active account identifiers and their local role."""
    with engine.connect() as connection:
        return all_rows(
            connection,
            """SELECT s.owner, max(s.created_at) AS last_sign_in,
            count(*) FILTER (WHERE s.ended_at IS NULL
                AND s.last_activity > now() - interval '30 minutes'
                AND s.created_at > now() - interval '12 hours') AS active_sessions,
            EXISTS (SELECT 1 FROM workspace_admins a WHERE a.owner = s.owner) AS is_admin
            FROM app_sessions s GROUP BY s.owner ORDER BY last_sign_in DESC LIMIT 100""",
        )


@api.get("/admin/sessions")
def admin_sessions(_admin: Annotated[str, Depends(require_admin)]):
    """List active session identifiers, never session secrets."""
    with engine.connect() as connection:
        return all_rows(
            connection,
            """SELECT id, owner, created_at, last_activity
            FROM app_sessions WHERE ended_at IS NULL
            AND last_activity > now() - interval '30 minutes'
            AND created_at > now() - interval '12 hours'
            ORDER BY last_activity DESC LIMIT 100""",
        )


@api.get("/admin/events")
def admin_events(_admin: Annotated[str, Depends(require_admin)]):
    """Return a bounded, secret-free operational audit history."""
    with engine.connect() as connection:
        return all_rows(
            connection,
            """SELECT created_at, event, actor, target FROM (
            SELECT created_at, event, owner AS actor, owner AS target FROM session_events
            UNION ALL
            SELECT created_at, 'role_' || event, 'local database operator' AS actor, owner AS target FROM admin_role_events
            UNION ALL
            SELECT created_at, event, actor, target FROM admin_action_events
            ) events ORDER BY created_at DESC LIMIT 100""",
        )


@api.delete("/admin/sessions/{session_id}", status_code=204)
def admin_end_session(session_id: UUID, admin: Annotated[str, Depends(require_admin)]):
    """End an active workspace session and record the administrator action."""
    with engine.begin() as connection:
        session = one(
            connection,
            """UPDATE app_sessions SET ended_at = now()
            WHERE id = :id AND ended_at IS NULL
            AND last_activity > now() - interval '30 minutes'
            AND created_at > now() - interval '12 hours' RETURNING owner""",
            id=session_id,
        )
        if session is None:
            raise HTTPException(404, "Active session not found.")
        query(
            connection,
            """INSERT INTO admin_action_events (actor, target, session_id, event)
            VALUES (:actor, :target, :session, 'session_terminated')""",
            actor=admin,
            target=session["owner"],
            session=session_id,
        )


@api.post("/session", status_code=201)
def start_session(owner: Annotated[str, Depends(verified_owner)]):
    """Create a workspace session for a verified identity."""
    return {"session_key": create_session(owner)}


@api.delete("/session", status_code=204)
def end_session(
    owner: Annotated[str, Depends(verified_owner)],
    session_key: Annotated[str | None, Header(alias="X-Workspace-Session")] = None,
):
    """Revoke this workspace session without storing its secret in logs."""
    check_session(owner, session_key, touch=False, end=True)


@app.middleware("http")
async def private_cache_headers(request: Request, call_next):
    """Prevent browser and intermediary caches storing API responses."""
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store"
    return response


def owned_project(connection, project_id, owner, *, lock=False):
    """Find a project only within the current account."""
    statement = """
        SELECT id, title, description, task, plan, features, share_private
        FROM projects WHERE id = :id AND owner = :owner
    """
    project = one(
        connection,
        statement + (" FOR UPDATE" if lock else ""),
        id=project_id,
        owner=owner,
    )
    if project is None:
        raise HTTPException(404, "Project not found.")
    return project


def ensure_capacity(connection, project_id, owner, *, outbound=False):
    """Apply per-account job quotas with transaction-scoped locking."""
    query(
        connection,
        "SELECT pg_advisory_xact_lock(hashtextextended(:owner, 0))",
        owner=owner,
    )
    counts = one(
        connection,
        """
        SELECT count(*) FILTER (WHERE j.status IN ('queued', 'running')) AS active,
        count(*) FILTER (WHERE j.kind IN ('plan','features','answer')
            OR (j.kind = 'retrieve' AND j.input->>'mode' = 'answer')) AS ai
        FROM jobs j JOIN projects p ON p.id = j.project_id
        WHERE p.owner = :owner AND (
            j.created_at >= now() - interval '1 day' OR j.status IN ('queued','running')
        )
    """,
        owner=owner,
    )
    if counts["active"] >= 5 or (outbound and counts["ai"] >= 25):
        raise HTTPException(
            429, "Job quota reached. Wait for current jobs or try again tomorrow."
        )
    owned_project(connection, project_id, owner, lock=True)


@api.get("/health")
def health():
    """Check the local API and its database connection."""
    with engine.connect() as connection:
        query(connection, "SELECT 1 FROM projects LIMIT 1")
    return {"status": "ok"}


@api.get("/config")
def configuration():
    """Return only the settings needed by the public browser client."""
    return {
        "domain": os.getenv("AUTH0_DOMAIN", ""),
        "audience": os.getenv("AUTH0_AUDIENCE", ""),
        "clientId": os.getenv("AUTH0_CLIENT_ID", ""),
    }


@api.get("/guides")
def guides():
    """List bundled use cases."""
    return GUIDES


@api.get("/projects", response_model=list[ProjectOutput])
def projects(owner: Owner):
    """List private projects for this account."""
    with engine.connect() as connection:
        return all_rows(
            connection,
            """
            SELECT id, title, description, task, plan, features, share_private
            FROM projects WHERE owner = :owner ORDER BY created_at DESC
        """,
            owner=owner,
        )


@api.post("/projects", response_model=ProjectOutput, status_code=201)
def create_project(body: ProjectInput, owner: Owner):
    """Create a project with an editable starting plan."""
    guide = next((item for item in GUIDES if item["id"] == body.guide), None)
    if body.guide and (guide is None or guide["task"] != body.task):
        raise HTTPException(422, "Choose a supported guide for this task.")
    plan = Plan(
        objective=body.description,
        explanation=guide["sections"].get("Problem and target", "") if guide else "",
        steps=[
            "Confirm the target and prediction cutoff.",
            "Profile the data and select features.",
            "Evaluate a baseline on held-out rows.",
        ],
        evaluation=guide["sections"].get("Evaluation", "") if guide else "",
    )
    with engine.begin() as connection:
        return one(
            connection,
            """
            INSERT INTO projects (owner,title,description,task,plan)
            VALUES (:owner,:title,:description,:task,CAST(:plan AS jsonb))
            RETURNING id,title,description,task,plan,features,share_private
        """,
            owner=owner,
            title=body.title,
            description=body.description,
            task=body.task,
            plan=plan.model_dump_json(),
        )


@api.get("/projects/{project_id}", response_model=ProjectOutput)
def project_details(project_id: UUID, owner: Owner):
    """Read one owned project."""
    with engine.connect() as connection:
        return owned_project(connection, project_id, owner)


@api.put("/projects/{project_id}/plan", response_model=Plan)
def save_plan(project_id: UUID, body: Plan, owner: Owner):
    """Save the current editable project plan."""
    with engine.begin() as connection:
        owned_project(connection, project_id, owner, lock=True)
        query(
            connection,
            "UPDATE projects SET plan = CAST(:value AS jsonb) WHERE id = :id",
            id=project_id,
            value=body.model_dump_json(),
        )
    return body


@api.put("/projects/{project_id}/features", response_model=Features)
def save_features(project_id: UUID, body: Features, owner: Owner):
    """Save a feature specification."""
    if body.target in body.available or not set(body.selected).issubset(body.available):
        raise HTTPException(
            422,
            "Selected features must be available at prediction time and exclude the target.",
        )
    names = [column.name for column in body.manual]
    transforms = [transform.name for transform in body.transforms]
    if len(set(names)) != len(names) or len(set(transforms)) != len(transforms):
        raise HTTPException(422, "Column and derived feature names must be unique.")
    for transform in body.transforms:
        if (
            transform.name in {*body.available, body.target}
            or transform.source not in body.available
            or (
                transform.operation == "ratio"
                and transform.denominator not in body.available
            )
        ):
            raise HTTPException(
                422,
                "Use a new feature name and prediction-time inputs for each transformation.",
            )
    with engine.begin() as connection:
        owned_project(connection, project_id, owner, lock=True)
        query(
            connection,
            "UPDATE projects SET features = CAST(:value AS jsonb) WHERE id = :id",
            id=project_id,
            value=body.model_dump_json(),
        )
    return body


@api.get("/projects/{project_id}/uploads", response_model=list[UploadOutput])
def uploads(project_id: UUID, owner: Owner):
    """List dataset and document metadata."""
    with engine.connect() as connection:
        owned_project(connection, project_id, owner)
        return all_rows(
            connection,
            """
            SELECT id,name,kind,status,profile FROM uploads WHERE project_id = :id ORDER BY created_at DESC
        """,
            id=project_id,
        )


@api.post("/projects/{project_id}/uploads", status_code=202, response_model=UploadJob)
def upload_file(project_id: UUID, owner: Owner, file: Annotated[UploadFile, File()]):
    """Save a bounded private upload and schedule processing."""
    name = Path((file.filename or "").replace(chr(92), "/")).name
    suffix = Path(name).suffix.lower()
    if not name or len(name) > 160 or suffix not in (".csv", ".pdf", ".md", ".txt"):
        raise HTTPException(
            422, "Choose a CSV, text-based PDF, Markdown, or text file."
        )
    if file.size is not None and file.size > UPLOAD_LIMIT:
        raise HTTPException(413, "Uploads are limited to 10 MB.")
    key = uuid4()
    destination = path_for(key)
    kind = "csv" if suffix == ".csv" else "document"
    try:
        with engine.begin() as connection:
            ensure_capacity(connection, project_id, owner)
            total = 0
            with destination.open("xb") as output:
                while block := file.file.read(65536):
                    total += len(block)
                    if total > UPLOAD_LIMIT:
                        raise HTTPException(413, "Uploads are limited to 10 MB.")
                    output.write(block)
            if not total:
                raise HTTPException(422, "The file is empty.")
            upload = one(
                connection,
                """
                INSERT INTO uploads (project_id,name,kind,storage_key)
                VALUES (:project,:name,:kind,:key) RETURNING id
            """,
                project=project_id,
                name=name,
                kind=kind,
                key=key,
            )
            job_id = enqueue(
                connection,
                project_id,
                "profile" if kind == "csv" else "index",
                upload_id=upload["id"],
            )
    except Exception:
        destination.unlink(missing_ok=True)
        raise
    return {"upload_id": upload["id"], "job_id": job_id}


@api.delete("/projects/{project_id}/uploads/{upload_id}", status_code=204)
def remove_upload(project_id: UUID, upload_id: UUID, owner: Owner):
    """Delete a source and all of its indexed data."""
    with engine.begin() as connection:
        owned_project(connection, project_id, owner, lock=True)
        upload = one(
            connection,
            """
            DELETE FROM uploads WHERE id = :upload AND project_id = :project RETURNING storage_key
        """,
            upload=upload_id,
            project=project_id,
        )
        if upload is None:
            raise HTTPException(404, "Upload not found.")
        path_for(upload["storage_key"]).unlink(missing_ok=True)


@api.put("/projects/{project_id}/consent", response_model=Consent)
def set_consent(project_id: UUID, body: Consent, owner: Owner):
    """Enable or revoke sharing of retrieved private excerpts."""
    with engine.begin() as connection:
        owned_project(connection, project_id, owner, lock=True)
        query(
            connection,
            """
            UPDATE projects SET share_private = :share, consent_changed_at = now() WHERE id = :id
        """,
            id=project_id,
            share=body.share_private,
        )
    return body


@api.post("/projects/{project_id}/questions", status_code=202)
def ask_question(project_id: UUID, body: Question, owner: Owner) -> dict[str, UUID]:
    """Queue retrieval and optionally an AI answer."""
    with engine.begin() as connection:
        ensure_capacity(connection, project_id, owner, outbound=body.mode == "answer")
        return {
            "job_id": enqueue(connection, project_id, "retrieve", body.model_dump())
        }


@api.post("/projects/{project_id}/analysis/{operation}", status_code=202)
def run_analysis(
    project_id: UUID,
    operation: Literal["preview", "baseline"],
    body: DatasetJob,
    owner: Owner,
) -> dict[str, UUID]:
    """Queue a preview or baseline using the saved specification snapshot."""
    if operation == "baseline" and not body.independent_rows:
        raise HTTPException(
            422, "Confirm that the rows are independent before using a random split."
        )
    with engine.begin() as connection:
        ensure_capacity(connection, project_id, owner)
        project = owned_project(connection, project_id, owner)
        upload = one(
            connection,
            """
            SELECT id FROM uploads WHERE id = :id AND project_id = :project
            AND kind = 'csv' AND status = 'succeeded'
        """,
            id=body.upload_id,
            project=project_id,
        )
        if upload is None:
            raise HTTPException(404, "Choose a successfully profiled CSV.")
        job = enqueue(
            connection,
            project_id,
            operation,
            {"features": project["features"], "task": project["task"]},
            upload["id"],
        )
    return {"job_id": job}


@api.get("/projects/{project_id}/results/latest")
def latest_result(project_id: UUID, owner: Owner) -> dict | None:
    """Restore the latest baseline result after the browser reloads."""
    with engine.connect() as connection:
        owned_project(connection, project_id, owner)
        result = one(
            connection,
            """
            SELECT result FROM jobs WHERE project_id = :id AND kind = 'baseline' AND status = 'succeeded'
            ORDER BY created_at DESC LIMIT 1
        """,
            id=project_id,
        )
    return result["result"] if result else None


def outbound_summary(connection, project):
    """Build the exact data eligible for an approved planning request."""
    upload = one(
        connection,
        """
        SELECT profile FROM uploads WHERE project_id = :id AND kind = 'csv'
        AND status = 'succeeded' ORDER BY created_at DESC LIMIT 1
    """,
        id=project["id"],
    )
    columns = project["features"].get("manual", [])
    if upload:
        columns = [
            {key: column[key] for key in ("name", "kind", "missing")}
            for column in upload["profile"]["columns"]
        ]
    payload = {
        "description": project["description"],
        "task": project["task"],
        "columns": columns,
    }
    return {
        "payload": payload,
        "digest": hashlib.sha256(json_value(payload).encode()).hexdigest(),
    }


@api.get("/projects/{project_id}/ai/summary")
def review_summary(project_id: UUID, owner: Owner):
    """Display the exact outbound planning data."""
    with engine.connect() as connection:
        return outbound_summary(
            connection, owned_project(connection, project_id, owner)
        )


@api.post("/projects/{project_id}/ai/{operation}", status_code=202)
def request_suggestion(
    project_id: UUID,
    operation: Literal["plan", "features"],
    body: Approval,
    owner: Owner,
) -> dict[str, UUID]:
    """Queue only the summary that the user explicitly reviewed."""
    with engine.begin() as connection:
        ensure_capacity(connection, project_id, owner, outbound=True)
        summary = outbound_summary(
            connection, owned_project(connection, project_id, owner)
        )
        if body.digest != summary["digest"]:
            raise HTTPException(409, "The data changed. Review the summary again.")
        return {
            "job_id": enqueue(connection, project_id, operation, summary["payload"])
        }


@api.get("/jobs/{job_id}", response_model=JobOutput)
def job_status(job_id: UUID, owner: Owner):
    """Read an owned job and resolve still-visible search results."""
    from app.retrieval_data import visible_chunks  # pylint: disable=import-outside-toplevel

    with engine.connect() as connection:
        job = one(
            connection,
            """
            SELECT j.id, j.kind, j.status, j.result, j.error, j.project_id
            FROM jobs j JOIN projects p ON p.id = j.project_id WHERE j.id = :id AND p.owner = :owner
        """,
            id=job_id,
            owner=owner,
        )
        if job is None:
            raise HTTPException(404, "Job not found.")
        result = job["result"]
        if job["status"] != "succeeded":
            job["result"] = None
        elif job["kind"] == "retrieve":
            job["result"] = {
                "sources": visible_chunks(connection, job["project_id"], result["ids"])
            }
        elif job["kind"] == "answer":
            sources = visible_chunks(connection, job["project_id"], result["citations"])
            if len(sources) != len(result["citations"]):
                job["result"] = {
                    "answer": "A source was deleted. Ask again to refresh the answer.",
                    "sources": [],
                }
            else:
                job["result"] = {"answer": result["answer"], "sources": sources}
        job.pop("project_id")
    return job


@api.get("/projects/{project_id}/exports/{kind}")
def export(project_id: UUID, kind: Literal["plan", "features"], owner: Owner):
    """Download the current plan or feature specification."""
    with engine.connect() as connection:
        project = owned_project(connection, project_id, owner)
    if kind == "features":
        return Response(
            Features(**project["features"]).model_dump_json(indent=2),
            media_type="application/json",
            headers={"Content-Disposition": 'attachment; filename="features.json"'},
        )
    plan = Plan(**project["plan"])
    sections = [
        f"# {project['title']}",
        f"## Objective\n{plan.objective}",
        f"## Explanation\n{plan.explanation}",
        "## Steps\n" + "\n".join(f"- {step}" for step in plan.steps),
        f"## Evaluation\n{plan.evaluation}",
    ]
    sections.extend(
        f"## {name.title()}\n{getattr(plan, name)}"
        for name in ("strengths", "weaknesses", "opportunities", "threats")
    )
    return Response(
        "\n\n".join(sections),
        media_type="text/markdown",
        headers={"Content-Disposition": 'attachment; filename="plan.md"'},
    )


app.include_router(api)
