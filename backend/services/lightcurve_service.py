from adapters.dummy_archive import archive, synthetic_magnitude, LIGHT_CURVE_MODELS
from schemas.lightcurve import (
    LightCurveRequest,
    LightCurvePoint,
    LightCurveResponse,
)


def build_lightcurve(req: LightCurveRequest) -> LightCurveResponse:
    model = LIGHT_CURVE_MODELS.get(req.target_id)
    period = req.fold_period or (model["period"] if model else None)
    do_fold = req.fold_period is not None

    points: list[LightCurvePoint] = []

    for obs_id in req.observation_ids:
        obs = archive.get_observation(obs_id)
        if not obs:
            continue

        mag, error = synthetic_magnitude(
            req.target_id, obs["hjd"], req.aperture_radius
        )

        phase = None
        if do_fold and period:
            t0 = model["t0"] if model else 2460100.0
            phase = round(((obs["hjd"] - t0) / period) % 1.0, 6)

        points.append(
            LightCurvePoint(
                hjd=obs["hjd"],
                phase=phase,
                magnitude=round(mag, 4),
                mag_error=round(error, 4),
            )
        )

    # Sort by phase if folded, otherwise by HJD
    if do_fold:
        points.sort(key=lambda p: p.phase or 0)
    else:
        points.sort(key=lambda p: p.hjd)

    return LightCurveResponse(
        target_id=req.target_id,
        period_days=period,
        points=points,
        x_label="Phase" if do_fold else "HJD",
        y_label="Magnitude",
    )
