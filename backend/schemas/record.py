from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


QuestionType = Literal["text", "textarea", "select", "radio", "checkbox", "number"]
WorkflowDraftStatus = Literal["active", "archived"]


class RecordQuestionOption(BaseModel):
    value: str
    label: str


class RecordQuestion(BaseModel):
    id: str
    label: str
    type: QuestionType
    required: bool = False
    placeholder: str | None = None
    help_text: str | None = None
    options: list[RecordQuestionOption] = Field(default_factory=list)
    min_value: float | None = None
    max_value: float | None = None


class RecordTemplateResponse(BaseModel):
    id: str
    workflow: str
    title: str
    description: str
    version: int = 1
    questions: list[RecordQuestion]


class RecordSubmissionRequest(BaseModel):
    workflow: str
    target_id: str
    observation_ids: list[str] = Field(default_factory=list)
    title: str
    context: dict[str, Any] = Field(default_factory=dict)
    answers: dict[str, Any] = Field(default_factory=dict)
    guide_answers: dict[str, str] = Field(default_factory=dict)


class RecordSubmissionResponse(BaseModel):
    submission_id: int
    title: str
    created_at: str
    export_path: str


class RecordListItemResponse(BaseModel):
    submission_id: int
    workflow: str
    template_id: str
    target_id: str
    observation_ids: list[str] = Field(default_factory=list)
    title: str
    created_at: str
    payload: dict[str, Any] = Field(default_factory=dict)


class RecordListResponse(BaseModel):
    records: list[RecordListItemResponse] = Field(default_factory=list)


class ShareTokenResponse(BaseModel):
    share_token: str
    share_url: str


class WorkflowDraftRequest(BaseModel):
    workflow: str
    target_id: str
    title: str | None = None
    seed_record_id: int | None = None
    status: WorkflowDraftStatus = "active"
    workflow_version: int = 1
    envelope: dict[str, Any] = Field(default_factory=dict)


class WorkflowDraftResponse(BaseModel):
    draft_id: str
    workflow: str
    target_id: str
    title: str | None = None
    seed_record_id: int | None = None
    status: WorkflowDraftStatus = "active"
    workflow_version: int = 1
    envelope: dict[str, Any] = Field(default_factory=dict)
    created_at: str
    updated_at: str
    last_opened_at: str | None = None


class WorkflowDraftListResponse(BaseModel):
    drafts: list[WorkflowDraftResponse] = Field(default_factory=list)
