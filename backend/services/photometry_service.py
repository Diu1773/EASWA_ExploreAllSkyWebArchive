import math

from adapters.dummy_archive import archive, synthetic_magnitude
from schemas.photometry import (
    PhotometryRequest,
    PhotometryMeasurement,
    PhotometryResponse,
)


def run_photometry(req: PhotometryRequest) -> PhotometryResponse:
    measurements: list[PhotometryMeasurement] = []

    for obs_id in req.observation_ids:
        obs = archive.get_observation(obs_id)
        if not obs:
            continue

        mag, error = synthetic_magnitude(
            req.target_id, obs["hjd"], req.aperture_radius
        )

        # Convert instrumental magnitude back to flux for educational display
        net_flux = 10 ** (-0.4 * mag) * 1e6  # arbitrary scaling
        sky_flux = net_flux * 0.05  # ~5% sky background
        raw_flux = net_flux + sky_flux

        measurements.append(
            PhotometryMeasurement(
                observation_id=obs_id,
                epoch=obs["epoch"],
                hjd=obs["hjd"],
                raw_flux=round(raw_flux, 2),
                sky_flux=round(sky_flux, 2),
                net_flux=round(net_flux, 2),
                instrumental_mag=round(mag, 4),
                mag_error=round(error, 4),
            )
        )

    measurements.sort(key=lambda m: m.hjd)

    return PhotometryResponse(
        target_id=req.target_id,
        aperture_radius=req.aperture_radius,
        measurements=measurements,
    )
