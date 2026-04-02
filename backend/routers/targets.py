from fastapi import APIRouter, HTTPException, Query

from schemas.target import TargetListResponse, TargetDetailResponse
from services import target_service

router = APIRouter(tags=["targets"])


@router.get("/targets", response_model=TargetListResponse)
def list_targets(
    topic: str | None = Query(None),
    max_targets: int | None = Query(None, ge=1, le=100),
    min_depth_pct: float | None = Query(None, ge=0.1, le=10.0),
    max_period_days: float | None = Query(None, ge=0.2, le=30.0),
    max_host_vmag: float | None = Query(None, ge=6.0, le=16.0),
):
    return target_service.list_targets(
        topic,
        max_targets=max_targets,
        min_depth_pct=min_depth_pct,
        max_period_days=max_period_days,
        max_host_vmag=max_host_vmag,
    )


@router.get("/targets/{target_id}", response_model=TargetDetailResponse)
def get_target(target_id: str):
    result = target_service.get_target(target_id)
    if not result:
        raise HTTPException(status_code=404, detail="Target not found")
    return result
