from pydantic import BaseModel, Field

from schemas.lightcurve import LightCurvePoint


class TransitFitRequest(BaseModel):
    target_id: str
    period: float
    t0: float
    fit_limb_darkening: bool = False
    points: list[LightCurvePoint] = Field(default_factory=list)


class TransitFitParameters(BaseModel):
    rp_rs: float
    rp_rs_err: float = 0.0
    a_rs: float
    a_rs_err: float = 0.0
    inclination: float
    inclination_err: float = 0.0
    u1: float
    u1_err: float = 0.0
    u2: float
    u2_err: float = 0.0
    chi_squared: float = 0.0
    reduced_chi_squared: float = 0.0
    degrees_of_freedom: int = 0


class TransitModelCurve(BaseModel):
    phase: list[float]
    flux: list[float]


class TransitFitResponse(BaseModel):
    target_id: str
    period: float
    t0: float
    fitted_params: TransitFitParameters
    initial_params: TransitFitParameters
    model_curve: TransitModelCurve
    initial_curve: TransitModelCurve
    data_phase: list[float]
    data_flux: list[float]
    data_error: list[float]
    residuals: list[float]
