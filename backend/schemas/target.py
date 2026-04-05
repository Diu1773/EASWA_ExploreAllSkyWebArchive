from pydantic import BaseModel


class Target(BaseModel):
    id: str
    name: str
    ra: float
    dec: float
    constellation: str
    type: str
    period_days: float | None = None
    magnitude_range: str
    description: str
    topic_id: str
    data_source: str | None = None
    stellar_temperature: float | None = None
    stellar_logg: float | None = None
    stellar_metallicity: float | None = None


class TargetListResponse(BaseModel):
    targets: list[Target]


class TargetDetailResponse(BaseModel):
    target: Target
    observation_count: int
