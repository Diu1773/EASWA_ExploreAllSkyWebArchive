from fastapi import APIRouter, HTTPException, Query

from schemas.microlensing import (
    MicrolensingLightCurveResponse,
    MicrolensingFitRequest,
    MicrolensingFitResponse,
    MicrolensingPreviewBundleResponse,
    MicrolensingPreviewResponse,
)
from services import microlensing_service

router = APIRouter(tags=["kmtnet"])


@router.get("/kmtnet/lightcurve/{target_id}", response_model=MicrolensingLightCurveResponse)
def get_microlensing_lightcurve(
    target_id: str,
    site: str | None = Query(default=None, description="Filter by site: ctio, saao, sso"),
    mode: str = Query(default="quick", description="Extraction mode: quick or detailed"),
    include_site: list[str] | None = Query(
        default=None,
        description="Requested merge sites when site is omitted.",
    ),
    reference_frame_index: int | None = Query(
        default=None,
        ge=0,
        description="Optional manual reference frame index for single-site extraction.",
    ),
):
    try:
        return microlensing_service.get_lightcurve(
            target_id,
            site=site,
            mode=mode,
            include_sites=include_site,
            reference_frame_index=reference_frame_index,
        )
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@router.post("/kmtnet/fit", response_model=MicrolensingFitResponse)
def fit_microlensing_model(req: MicrolensingFitRequest):
    try:
        return microlensing_service.fit_paczynski(req)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@router.get("/kmtnet/preview/{target_id}", response_model=MicrolensingPreviewResponse)
def get_microlensing_preview(
    target_id: str,
    site: str = Query(..., description="Site id: ctio, saao, sso"),
    frame_index: int | None = Query(default=None, ge=0, description="Preview frame index"),
    reference_frame_index: int | None = Query(
        default=None,
        ge=0,
        description="Optional manual reference frame index.",
    ),
    size_px: int = Query(default=64, ge=48, le=96, description="Actual cutout size in pixels"),
):
    try:
        return microlensing_service.get_preview(
            target_id,
            site=site,
            frame_index=frame_index,
            size_px=size_px,
            reference_frame_index=reference_frame_index,
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@router.get("/kmtnet/preview-bundle/{target_id}", response_model=MicrolensingPreviewBundleResponse)
def get_microlensing_preview_bundle(
    target_id: str,
    site: str = Query(..., description="Site id: ctio, saao, sso"),
    focus_frame_index: int | None = Query(default=None, ge=0, description="Focus frame index"),
    reference_frame_index: int | None = Query(
        default=None,
        ge=0,
        description="Optional manual reference frame index.",
    ),
    size_px: int = Query(default=64, ge=48, le=96, description="Actual cutout size in pixels"),
):
    try:
        return microlensing_service.get_preview_bundle(
            target_id,
            site=site,
            focus_frame_index=focus_frame_index,
            size_px=size_px,
            reference_frame_index=reference_frame_index,
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
