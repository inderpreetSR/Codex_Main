"""Request and response contracts shared by the API and workers."""

from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

Title = Annotated[str, Field(min_length=1, max_length=160)]
ColumnName = Annotated[str, Field(min_length=1, max_length=120)]
Paragraph = Annotated[str, Field(max_length=4000)]
Task = Literal["classification", "regression"]
OFFLINE_JOBS = ("profile", "preview", "baseline", "index", "retrieve")
AI_JOBS = ("plan", "features", "answer")


class JobError(ValueError):
    """A bounded, user-facing processing error."""


class Contract(BaseModel):
    """Reject unknown request properties."""

    model_config = ConfigDict(extra="forbid")


class Plan(Contract):
    """Editable project plan."""

    objective: Paragraph = ""
    explanation: Paragraph = ""
    steps: list[Paragraph] = Field(default_factory=list, max_length=12)
    evaluation: Paragraph = ""
    strengths: Paragraph = ""
    weaknesses: Paragraph = ""
    opportunities: Paragraph = ""
    threats: Paragraph = ""


class Column(Contract):
    """Manually described input column."""

    name: ColumnName
    kind: Literal["numeric", "categorical"]


class Transform(Contract):
    """A predefined feature operation."""

    name: ColumnName
    operation: Literal["missing", "log", "ratio", "encode"]
    source: ColumnName
    denominator: ColumnName | None = None


class Features(Contract):
    """Saved feature choices."""

    manual: list[Column] = Field(default_factory=list, max_length=100)
    target: ColumnName | None = None
    available: list[ColumnName] = Field(default_factory=list, max_length=100)
    selected: list[ColumnName] = Field(default_factory=list, max_length=100)
    transforms: list[Transform] = Field(default_factory=list, max_length=30)


class ProjectInput(Contract):
    """Create a project from a description or a guide."""

    title: Title
    description: Paragraph = ""
    task: Task
    guide: str | None = None


class ProjectOutput(Contract):
    """A project and its saved specifications."""

    id: UUID
    title: str
    description: str
    task: Task
    plan: Plan
    features: Features
    share_private: bool


class UploadOutput(Contract):
    """Metadata about an uploaded file."""

    id: UUID
    name: str
    kind: Literal["csv", "document"]
    status: str
    profile: dict | None


class JobOutput(Contract):
    """Pollable job state and output."""

    id: UUID
    kind: str
    status: Literal["queued", "running", "succeeded", "failed"]
    result: dict | None = None
    error: str | None = None


class UploadJob(Contract):
    """Identifiers returned after an upload."""

    upload_id: UUID
    job_id: UUID


class DatasetJob(Contract):
    """Select a dataset for preview or baseline evaluation."""

    upload_id: UUID
    independent_rows: bool = False


class Consent(Contract):
    """Project-level permission to send private excerpts."""

    share_private: bool


class Question(Contract):
    """A question for local search or AI answers."""

    question: Annotated[str, Field(min_length=1, max_length=1500)]
    mode: Literal["search", "answer"]


class Approval(Contract):
    """Hash of the displayed outbound summary."""

    digest: Annotated[str, Field(pattern=r"^[a-f0-9]{64}$")]
