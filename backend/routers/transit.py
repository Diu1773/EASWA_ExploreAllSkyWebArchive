from fastapi import APIRouter, HTTPException, Query, Request

from schemas.transit import (
    TransitCutoutPreviewResponse,
    TransitPhotometryRequest,
    TransitPhotometryResponse,
    TransitPreviewJobResponse,
)
from schemas.transit_fit import TransitFitRequest, TransitFitResponse
from services.rate_limit_service import enforce_rate_limit
from services import transit_service
from services import transit_fit_service

router = APIRouter(tags=["transit"])


@router.get(
    "/transit/targets/{target_id}/observations/{observation_id}/preview",
    response_model=TransitCutoutPreviewResponse,
)
def get_cutout_preview(
    request: Request,
    target_id: str,
    observation_id: str,
    size_px: int = Query(default=35, ge=30, le=40),
    frame_index: int | None = Query(default=None, ge=0),
):
    enforce_rate_limit(request, "transit_preview_inline")
    try:
        return transit_service.get_cutout_preview(
            target_id,
            observation_id,
            size_px=size_px,
            frame_index=frame_index,
        )
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(
            status_code=502,
            detail=f"Failed to load TESS cutout preview: {error}",
        ) from error


@router.post(
    "/transit/targets/{target_id}/observations/{observation_id}/preview-jobs",
    response_model=TransitPreviewJobResponse,
)
def create_cutout_preview_job(
    request: Request,
    target_id: str,
    observation_id: str,
    size_px: int = Query(default=35, ge=30, le=40),
    frame_index: int | None = Query(default=None, ge=0),
):
    enforce_rate_limit(request, "transit_preview_job")
    try:
        return transit_service.create_preview_job(
            target_id,
            observation_id,
            size_px=size_px,
            frame_index=frame_index,
        )
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except transit_service.PreviewCapacityError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error


@router.get(
    "/transit/preview-jobs/{job_id}",
    response_model=TransitPreviewJobResponse,
)
def get_cutout_preview_job(job_id: str):
    try:
        return transit_service.get_preview_job(job_id)
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@router.post(
    "/transit/preview-jobs/{job_id}/cancel",
    response_model=TransitPreviewJobResponse,
)
def cancel_cutout_preview_job(job_id: str):
    try:
        return transit_service.cancel_preview_job(job_id)
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@router.post(
    "/transit/photometry",
    response_model=TransitPhotometryResponse,
)
def run_transit_photometry(request: Request, req: TransitPhotometryRequest):
    enforce_rate_limit(request, "transit_photometry")
    try:
        return transit_service.run_transit_photometry(req)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(
            status_code=502,
            detail=f"Transit photometry failed: {error}",
        ) from error


@router.post(
    "/transit/fit",
    response_model=TransitFitResponse,
)
def fit_transit(request: Request, req: TransitFitRequest):
    enforce_rate_limit(request, "transit_fit")
    try:
        return transit_fit_service.fit_transit_model(
            points=req.points,
            period=req.period,
            t0=req.t0,
            target_id=req.target_id,
            fit_limb_darkening=req.fit_limb_darkening,
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(
            status_code=502,
            detail=f"Transit model fitting failed: {error}",
        ) from error
