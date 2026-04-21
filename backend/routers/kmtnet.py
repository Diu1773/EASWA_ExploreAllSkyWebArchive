from fastapi import APIRouter, HTTPException, Query

from schemas.microlensing import (
    MicrolensingLightCurveResponse,
    MicrolensingFitRequest,
    MicrolensingFitResponse,
    MicrolensingPreviewResponse,
)
from services import microlensing_service

router = APIRouter(tags=["kmtnet"])


@router.get("/kmtnet/lightcurve/{target_id}", response_model=MicrolensingLightCurveResponse)
def get_microlensing_lightcurve(
    target_id: str,
    site: str | None = Query(default=None, description="Filter by site: ctio, saao, sso"),
):
    try:
        return microlensing_service.get_lightcurve(target_id, site=site)
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
    size_px: int = Query(default=64, ge=48, le=96, description="Actual cutout size in pixels"),
):
    try:
        return microlensing_service.get_preview(
            target_id,
            site=site,
            frame_index=frame_index,
            size_px=size_px,
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
