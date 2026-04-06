from __future__ import annotations

from db import (
    delete_analysis_draft,
    get_analysis_draft,
    list_analysis_drafts,
    upsert_analysis_draft,
)
from schemas.record import (
    WorkflowDraftListResponse,
    WorkflowDraftRequest,
    WorkflowDraftResponse,
)


def upsert_draft_for_user(
    draft_id: str,
    request: WorkflowDraftRequest,
    user_id: int,
) -> WorkflowDraftResponse:
    normalized_draft_id = draft_id.strip()
    if not normalized_draft_id:
        raise ValueError("Draft id is required.")

    workflow = request.workflow.strip()
    target_id = request.target_id.strip()
    if not workflow:
        raise ValueError("Workflow is required.")
    if not target_id:
        raise ValueError("Target id is required.")

    draft = upsert_analysis_draft(
        draft_id=normalized_draft_id,
        workflow=workflow,
        user_id=user_id,
        target_id=target_id,
        title=request.title,
        seed_record_id=request.seed_record_id,
        status=request.status,
        workflow_version=request.workflow_version,
        envelope=dict(request.envelope),
    )
    return WorkflowDraftResponse(**draft)


def list_drafts_for_user(user_id: int) -> WorkflowDraftListResponse:
    drafts = list_analysis_drafts(user_id)
    return WorkflowDraftListResponse(
        drafts=[WorkflowDraftResponse(**draft) for draft in drafts]
    )


def get_draft_for_user(draft_id: str, user_id: int) -> WorkflowDraftResponse:
    draft = get_analysis_draft(draft_id.strip(), user_id)
    if not draft:
        raise ValueError("Analysis draft not found.")
    return WorkflowDraftResponse(**draft)


def delete_draft_for_user(draft_id: str, user_id: int) -> None:
    deleted = delete_analysis_draft(draft_id.strip(), user_id)
    if not deleted:
        raise ValueError("Analysis draft not found.")
