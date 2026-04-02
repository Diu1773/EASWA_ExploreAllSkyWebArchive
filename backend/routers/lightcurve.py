from fastapi import APIRouter

from schemas.lightcurve import LightCurveRequest, LightCurveResponse
from services import lightcurve_service

router = APIRouter(tags=["lightcurve"])


@router.post("/lightcurve", response_model=LightCurveResponse)
def build_lightcurve(req: LightCurveRequest):
    return lightcurve_service.build_lightcurve(req)
