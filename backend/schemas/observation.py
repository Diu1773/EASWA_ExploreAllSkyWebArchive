from pydantic import BaseModel


class Observation(BaseModel):
    id: str
    target_id: str
    epoch: str
    hjd: float
    filter_band: str
    exposure_sec: float
    thumbnail_url: str
    airmass: float
    mission: str | None = None
    sector: int | None = None
    camera: int | None = None
    ccd: int | None = None
    display_label: str | None = None
    display_subtitle: str | None = None
    cutout_url: str | None = None


class ObservationListResponse(BaseModel):
    target_id: str
    observations: list[Observation]
