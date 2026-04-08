from fastapi import APIRouter, HTTPException, Request, Response

from config import BASE_URL, RECORD_REQUIRE_LOGIN
from routers.auth import get_current_user
from schemas.record import (
    RecordListResponse,
    RecordSubmissionRequest,
    RecordSubmissionResponse,
    RecordTemplateResponse,
    ShareTokenResponse,
)
from services.rate_limit_service import enforce_rate_limit
from services import record_service
from db import create_or_get_share_token, get_analysis_record_by_token

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


@router.get("/records/mine/{record_id}/photometry.csv")
def download_my_record_photometry_csv(record_id: int, request: Request):
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not logged in.")
    try:
        filename, content = record_service.export_transit_record_csv_for_user(
            record_id,
            user["id"],
        )
    except ValueError as error:
        detail = str(error)
        status_code = 404 if "not found" in detail.lower() else 400
        raise HTTPException(status_code=status_code, detail=detail) from error

    return Response(
        content=content,
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
        },
    )


@router.delete("/records/mine/{record_id}", status_code=204)
def delete_my_record(record_id: int, request: Request):
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not logged in.")
    try:
        record_service.delete_record_for_user(record_id, user["id"])
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    return Response(status_code=204)


@router.post("/records/mine/{record_id}/share", response_model=ShareTokenResponse)
def create_record_share_link(record_id: int, request: Request):
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not logged in.")
    token = create_or_get_share_token(record_id, user["id"])
    if token is None:
        raise HTTPException(status_code=404, detail="Record not found.")
    return ShareTokenResponse(
        share_token=token,
        share_url=f"{BASE_URL}/shared/{token}",
    )


@router.get("/records/shared/{token}", response_model=RecordListResponse)
def get_shared_record(token: str):
    record = get_analysis_record_by_token(token)
    if not record:
        raise HTTPException(status_code=404, detail="Shared record not found or link is invalid.")
    from schemas.record import RecordListItemResponse
    item = RecordListItemResponse(
        submission_id=record["id"],
        workflow=record["workflow"],
        template_id=record["template_id"],
        target_id=record["target_id"],
        observation_ids=record["observation_ids"],
        title=record["title"],
        created_at=record["created_at"],
        payload=record["payload"],
    )
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
    enforce_rate_limit(request, "record_submission")
    user = get_current_user(request)
    if RECORD_REQUIRE_LOGIN and not user:
        raise HTTPException(status_code=401, detail="Login is required to submit analysis records.")
    try:
        return record_service.submit_record(
            template_id,
            payload,
            user["id"] if user else None,
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
