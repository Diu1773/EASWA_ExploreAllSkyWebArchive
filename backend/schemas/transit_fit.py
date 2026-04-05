from pydantic import BaseModel, Field

from schemas.lightcurve import LightCurvePoint


class TransitFitRequest(BaseModel):
    target_id: str
    period: float
    t0: float
    fit_mode: str = "phase_fold"
    bjd_start: float | None = None
    bjd_end: float | None = None
    fit_limb_darkening: bool = False
    fit_window_phase: float = 0.12
    baseline_order: int = 1
    sigma_clip_sigma: float = 4.0
    sigma_clip_iterations: int = 2
    filter_name: str | None = None
    stellar_temperature: float | None = None
    stellar_logg: float | None = None
    stellar_metallicity: float | None = None
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


class TransitFitPreprocessing(BaseModel):
    fit_mode: str = "phase_fold"
    fit_window_phase: float
    bjd_start: float | None = None
    bjd_end: float | None = None
    limb_darkening_source: str | None = None
    limb_darkening_filter: str | None = None
    baseline_order: int
    sigma_clip_sigma: float
    sigma_clip_iterations: int
    retained_points: int = 0
    clipped_points: int = 0


class TransitFitResponse(BaseModel):
    target_id: str
    period: float
    t0: float
    reference_t0: float
    limb_darkening_source: str | None = None
    limb_darkening_filter: str | None = None
    used_batman: bool = True
    used_mcmc: bool = False
    preprocessing: TransitFitPreprocessing
    fitted_params: TransitFitParameters
    initial_params: TransitFitParameters
    model_curve: TransitModelCurve
    initial_curve: TransitModelCurve
    model_time: list[float]
    data_time: list[float]
    data_phase: list[float]
    data_flux: list[float]
    data_error: list[float]
    residuals: list[float]
