from fastapi import APIRouter, HTTPException, Request

from routers.auth import get_current_user
from schemas.record import (
    RecordListResponse,
    RecordSubmissionRequest,
    RecordSubmissionResponse,
    RecordTemplateResponse,
)
from services import record_service

router = APIRouter(tags=["records"])


@router.get("/records/templates/{template_id}", response_model=RecordTemplateResponse)
def get_record_template(template_id: str):
    try:
        return record_service.get_template(template_id)
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@router.get("/records/mine", response_model=RecordListResponse)
def list_my_records(request: Request):
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not logged in.")
    return record_service.list_records_for_user(user["id"])


@router.get("/records/mine/{record_id}", response_model=RecordListResponse)
def get_my_record(record_id: int, request: Request):
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not logged in.")
    try:
        item = record_service.get_record_for_user(record_id, user["id"])
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    return RecordListResponse(records=[item])


@router.post(
    "/records/templates/{template_id}/submissions",
    response_model=RecordSubmissionResponse,
)
def submit_record_template(
    template_id: str,
    request: Request,
    payload: RecordSubmissionRequest,
):
    user = get_current_user(request)
    try:
        return record_service.submit_record(
            template_id,
            payload,
            user["id"] if user else None,
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
