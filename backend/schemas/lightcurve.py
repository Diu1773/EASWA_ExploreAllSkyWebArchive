from pydantic import BaseModel


class LightCurveRequest(BaseModel):
    target_id: str
    observation_ids: list[str]
    aperture_radius: float = 5.0
    inner_annulus: float = 10.0
    outer_annulus: float = 15.0
    fold_period: float | None = None


class LightCurvePoint(BaseModel):
    hjd: float
    phase: float | None = None
    magnitude: float
    mag_error: float


class LightCurveResponse(BaseModel):
    target_id: str
    period_days: float | None
    points: list[LightCurvePoint]
    x_label: str
    y_label: str
