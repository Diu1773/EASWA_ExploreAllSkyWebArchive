from pydantic import BaseModel


class PhotometryRequest(BaseModel):
    target_id: str
    observation_ids: list[str]
    aperture_radius: float = 5.0
    inner_annulus: float = 10.0
    outer_annulus: float = 15.0


class PhotometryMeasurement(BaseModel):
    observation_id: str
    epoch: str
    hjd: float
    raw_flux: float
    sky_flux: float
    net_flux: float
    instrumental_mag: float
    mag_error: float


class PhotometryResponse(BaseModel):
    target_id: str
    aperture_radius: float
    measurements: list[PhotometryMeasurement]
