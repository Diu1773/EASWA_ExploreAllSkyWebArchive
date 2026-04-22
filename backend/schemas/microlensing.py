from pydantic import BaseModel, Field


class MicrolensingPoint(BaseModel):
    hjd: float
    site: str
    magnitude: float
    mag_error: float


class MicrolensingLightCurveResponse(BaseModel):
    target_id: str
    points: list[MicrolensingPoint]
    x_label: str
    y_label: str
    extraction_mode: str = "quick"
    requested_sites: list[str] = Field(default_factory=list)
    included_sites: list[str] = Field(default_factory=list)
    missing_sites: list[str] = Field(default_factory=list)
    sampled_observation_ids: dict[str, list[str]] = Field(default_factory=dict)
    reference_observation_ids: dict[str, str] = Field(default_factory=dict)
    excluded_observation_ids: dict[str, list[str]] = Field(default_factory=dict)
    warnings: list[str] = Field(default_factory=list)
    is_complete: bool = True


class MicrolensingFitInputPoint(BaseModel):
    hjd: float
    magnitude: float
    mag_error: float


class MicrolensingFitRequest(BaseModel):
    target_id: str
    points: list[MicrolensingFitInputPoint]
    t0_init: float | None = None
    u0_init: float | None = None
    tE_init: float | None = None


class MicrolensingModelPoint(BaseModel):
    hjd: float
    magnitude: float


class MicrolensingFitResponse(BaseModel):
    t0: float
    u0: float
    tE: float
    mag_base: float
    t0_err: float
    u0_err: float
    tE_err: float
    mag_base_err: float
    chi2_dof: float
    model_curve: list[MicrolensingModelPoint]


class MicrolensingPixelCoordinate(BaseModel):
    x: float
    y: float


class MicrolensingPreviewFrameMetadata(BaseModel):
    frame_index: int
    observation_id: str
    hjd: float
    site: str
    filter_band: str | None = None
    exposure_sec: float | None = None
    airmass: float | None = None
    magnitude: float
    mag_error: float
    baseline_magnitude: float
    magnification: float


class MicrolensingPreviewResponse(BaseModel):
    target_id: str
    site: str
    site_label: str
    frame_index: int
    frame_count: int
    sample_frame_indices: list[int]
    cutout_size_px: int
    cutout_width_px: int
    cutout_height_px: int
    preview_width_px: int
    preview_height_px: int
    target_position: MicrolensingPixelCoordinate
    raw_target_position: MicrolensingPixelCoordinate
    aligned_target_position: MicrolensingPixelCoordinate
    reference_target_position: MicrolensingPixelCoordinate
    reference_frame_index: int
    reference_candidate_indices: list[int] = Field(default_factory=list)
    reference_observation_id: str
    reference_hjd: float
    registration_dx_px: float
    registration_dy_px: float
    registration_quality_score: float
    registration_hit_limit: bool
    registration_warning: str | None = None
    frame_metadata: MicrolensingPreviewFrameMetadata
    raw_image_data_url: str
    aligned_image_data_url: str
    reference_image_data_url: str
    difference_image_data_url: str
