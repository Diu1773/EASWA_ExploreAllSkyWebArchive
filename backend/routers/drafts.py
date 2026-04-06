from fastapi import APIRouter, HTTPException, Request, Response

from routers.auth import get_current_user
from schemas.record import (
    WorkflowDraftListResponse,
    WorkflowDraftRequest,
    WorkflowDraftResponse,
)
from services import draft_service

router = APIRouter(tags=["drafts"])


@router.get("/drafts/mine", response_model=WorkflowDraftListResponse)
def list_my_drafts(request: Request):
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not logged in.")
    return draft_service.list_drafts_for_user(user["id"])


@router.get("/drafts/mine/{draft_id}", response_model=WorkflowDraftResponse)
def get_my_draft(draft_id: str, request: Request):
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not logged in.")
    try:
        return draft_service.get_draft_for_user(draft_id, user["id"])
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@router.put("/drafts/mine/{draft_id}", response_model=WorkflowDraftResponse)
def upsert_my_draft(draft_id: str, payload: WorkflowDraftRequest, request: Request):
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not logged in.")
    try:
        return draft_service.upsert_draft_for_user(draft_id, payload, user["id"])
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@router.delete("/drafts/mine/{draft_id}", status_code=204)
def delete_my_draft(draft_id: str, request: Request):
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not logged in.")
    try:
        draft_service.delete_draft_for_user(draft_id, user["id"])
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    return Response(status_code=204)
