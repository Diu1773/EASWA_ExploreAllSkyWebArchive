from pydantic import BaseModel, Field

from schemas.lightcurve import LightCurveResponse


class PixelCoordinate(BaseModel):
    x: float
    y: float


class TransitApertureConfig(BaseModel):
    position: PixelCoordinate
    aperture_radius: float = 2.5
    inner_annulus: float = 4.0
    outer_annulus: float = 6.0


class TransitFrameMetadata(BaseModel):
    frame_index: int | None = None
    btjd: float | None = None
    cadence_number: int | None = None
    quality_flag: int | None = None
    finite_fraction: float | None = None
    finite_pixels: int | None = None
    total_pixels: int | None = None
    flux_min: float | None = None
    flux_median: float | None = None
    flux_max: float | None = None


class TICStarInfo(BaseModel):
    tic_id: str
    pixel: PixelCoordinate
    tmag: float | None = None
    distance_arcmin: float | None = None
    is_variable: bool = False
    recommended: bool = False


class TransitCutoutPreviewResponse(BaseModel):
    target_id: str
    observation_id: str
    sector: int
    camera: int | None = None
    ccd: int | None = None
    preview_mode: str = "median"
    frame_index: int | None = None
    sample_frame_indices: list[int] = Field(default_factory=list)
    cutout_size_px: int
    cutout_width_px: int
    cutout_height_px: int
    preview_width_px: int
    preview_height_px: int
    frame_count: int
    time_start: float
    time_end: float
    frame_metadata: TransitFrameMetadata | None = None
    target_position: PixelCoordinate
    image_data_url: str
    dataset_token: str | None = None
    tic_stars: list[TICStarInfo] = Field(default_factory=list)


class TransitTargetContext(BaseModel):
    ra: float
    dec: float
    period_days: float | None = None


class TransitObservationContext(BaseModel):
    sector: int
    camera: int | None = None
    ccd: int | None = None


class TransitPhotometryRequest(BaseModel):
    target_id: str
    observation_id: str
    cutout_size_px: int = 50
    preview_dataset_token: str | None = None
    target_context: TransitTargetContext | None = None
    observation_context: TransitObservationContext | None = None
    target_position: PixelCoordinate
    comparison_positions: list[PixelCoordinate] = Field(default_factory=list)
    aperture_radius: float = 2.5
    inner_annulus: float = 4.0
    outer_annulus: float = 6.0
    target_aperture: TransitApertureConfig | None = None
    comparison_apertures: list[TransitApertureConfig] = Field(default_factory=list)


class TransitComparisonDiagnostic(BaseModel):
    label: str
    position: PixelCoordinate
    aperture_radius: float
    inner_annulus: float
    outer_annulus: float
    valid_frame_count: int
    median_flux: float
    differential_rms: float
    differential_mad: float
    ensemble_weight: float
    light_curve: LightCurveResponse


class TransitPhotometryResponse(BaseModel):
    target_id: str
    observation_id: str
    sector: int
    frame_count: int
    comparison_count: int
    target_position: PixelCoordinate
    comparison_positions: list[PixelCoordinate]
    target_median_flux: float
    comparison_median_flux: float
    comparison_diagnostics: list[TransitComparisonDiagnostic] = Field(default_factory=list)
    light_curve: LightCurveResponse


class TransitPreviewJobResponse(BaseModel):
    job_id: str
    status: str
    progress: float
    message: str
    result: TransitCutoutPreviewResponse | None = None
    error: str | None = None
