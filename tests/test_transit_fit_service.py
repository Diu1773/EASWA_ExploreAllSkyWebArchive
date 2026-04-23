import sys
from pathlib import Path

import numpy as np


ROOT = Path(__file__).resolve().parents[1]
BACKEND_DIR = ROOT / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from schemas.lightcurve import LightCurvePoint
from services import transit_fit_service


def _build_synthetic_points(center: float = 1.0) -> list[LightCurvePoint]:
    times = np.linspace(0.0, 2.0, 240)
    flux = 1.0 + 0.0015 * (times - 1.0)
    in_transit = np.abs(times - center) <= 0.045
    flux[in_transit] -= 0.02
    return [
        LightCurvePoint(
            hjd=round(float(time_value), 6),
            phase=None,
            magnitude=round(float(flux_value), 6),
            mag_error=0.001,
        )
        for time_value, flux_value in zip(times, flux, strict=False)
    ]


def _build_noisy_batman_points(
    *,
    start: float,
    end: float,
    t0: float,
    period: float,
) -> list[LightCurvePoint]:
    if not transit_fit_service._HAS_BATMAN:
        raise RuntimeError("batman is required for this synthetic transit test")

    times = np.linspace(start, end, 240)
    phase = ((times - t0 + 0.5 * period) % period) / period - 0.5
    flux = transit_fit_service._evaluate_batman(
        phase,
        rp_rs=0.12,
        a_rs=8.5,
        inclination=86.8,
        u1=0.38,
        u2=0.22,
        exposure_phase=120 / (24 * 3600) / period,
    )
    rng = np.random.default_rng(2)
    flux = flux * (1 + 0.002 * (times - np.mean(times))) + rng.normal(
        0,
        0.0015,
        size=times.size,
    )
    return [
        LightCurvePoint(
            hjd=round(float(time_value), 6),
            phase=None,
            magnitude=round(float(flux_value), 6),
            mag_error=0.0015,
        )
        for time_value, flux_value in zip(times, flux, strict=False)
    ]


def test_fit_transit_model_supports_bjd_window_mode(monkeypatch):
    monkeypatch.setattr(transit_fit_service, "_HAS_EMCEE", False)

    result = transit_fit_service.fit_transit_model(
        points=_build_synthetic_points(),
        period=2.0,
        t0=1.0,
        fit_mode="bjd_window",
        bjd_start=0.82,
        bjd_end=1.18,
        fit_limb_darkening=False,
        baseline_order=1,
        sigma_clip_sigma=0.0,
        sigma_clip_iterations=0,
    )

    assert result.preprocessing.fit_mode == "bjd_window"
    assert result.preprocessing.bjd_start == 0.82
    assert result.preprocessing.bjd_end == 1.18
    assert result.preprocessing.retained_points >= 20
    assert result.preprocessing.baseline_order == 1
    assert len(result.data_phase) == result.preprocessing.retained_points
    assert len(result.model_curve.phase) == transit_fit_service._MODEL_PHASE_GRID
    assert len(result.initial_curve.phase) == transit_fit_service._MODEL_PHASE_GRID


def test_fit_transit_model_rejects_missing_bjd_window_bounds(monkeypatch):
    monkeypatch.setattr(transit_fit_service, "_HAS_EMCEE", False)

    try:
        transit_fit_service.fit_transit_model(
            points=_build_synthetic_points(),
            period=2.0,
            t0=1.0,
            fit_mode="bjd_window",
            bjd_start=None,
            bjd_end=1.18,
            fit_limb_darkening=False,
        )
    except ValueError as error:
        assert str(error) == "BJD window fitting requires both start and end times."
    else:
        raise AssertionError("Expected fit_transit_model to reject missing BJD bounds")


def test_resolve_quadratic_limb_darkening_uses_filter_and_stellar_params(monkeypatch):
    monkeypatch.setattr(
        transit_fit_service,
        "_resolve_tabulated_quadratic_limb_darkening",
        lambda **kwargs: None,
    )

    u1, u2, source, resolved_filter = (
        transit_fit_service._resolve_quadratic_limb_darkening(
            target_id="",
            filter_name="TESS",
            stellar_temperature=5304.0,
            stellar_logg=4.53,
            stellar_metallicity=0.19,
        )
    )

    assert resolved_filter == "TESS"
    assert source == "stellar_filter_heuristic"
    assert 0.2 < u1 < 0.6
    assert 0.05 < u2 < 0.4
    assert transit_fit_service._quadratic_ld_is_physical(u1, u2)


def test_resolve_quadratic_limb_darkening_falls_back_to_target_archive(monkeypatch):
    monkeypatch.setattr(
        transit_fit_service,
        "_resolve_tabulated_quadratic_limb_darkening",
        lambda **kwargs: None,
    )
    monkeypatch.setattr(
        transit_fit_service.transit_archive,
        "get_target",
        lambda target_id: {
            "id": target_id,
            "stellar_temperature": 5400.0,
            "stellar_logg": 4.45,
            "stellar_metallicity": 0.1,
        },
    )

    u1, u2, source, resolved_filter = (
        transit_fit_service._resolve_quadratic_limb_darkening(
            target_id="hats_5_b",
            filter_name="TESS",
            stellar_temperature=None,
            stellar_logg=None,
            stellar_metallicity=None,
        )
    )

    assert resolved_filter == "TESS"
    assert source == "stellar_filter_heuristic"
    assert transit_fit_service._quadratic_ld_is_physical(u1, u2)


def test_fit_transit_model_refines_mid_transit_time(monkeypatch):
    monkeypatch.setattr(transit_fit_service, "_HAS_EMCEE", False)

    result = transit_fit_service.fit_transit_model(
        points=_build_synthetic_points(center=1.025),
        period=2.0,
        t0=1.0,
        fit_mode="bjd_window",
        bjd_start=0.82,
        bjd_end=1.22,
        fit_limb_darkening=False,
        baseline_order=1,
        sigma_clip_sigma=0.0,
        sigma_clip_iterations=0,
    )

    assert abs(result.t0 - 1.025) < abs(1.0 - 1.025)


def test_fit_transit_model_phase_fold_respects_fit_window(monkeypatch):
    monkeypatch.setattr(transit_fit_service, "_HAS_EMCEE", False)

    roi_points = [
        point
        for point in _build_synthetic_points()
        if 0.8 <= point.hjd <= 1.2
    ]

    result = transit_fit_service.fit_transit_model(
        points=roi_points,
        period=2.0,
        t0=1.0,
        fit_mode="phase_fold",
        fit_window_phase=0.04,
        fit_limb_darkening=False,
        baseline_order=1,
        sigma_clip_sigma=0.0,
        sigma_clip_iterations=0,
    )

    assert result.preprocessing.fit_mode == "phase_fold"
    assert result.preprocessing.retained_points < len(roi_points)
    assert result.preprocessing.fit_window_phase == 0.04


def test_fit_transit_model_regularizes_noisy_limb_darkening_solution(monkeypatch):
    if not transit_fit_service._HAS_BATMAN:
        return

    monkeypatch.setattr(transit_fit_service, "_HAS_EMCEE", False)

    result = transit_fit_service.fit_transit_model(
        points=_build_noisy_batman_points(
            start=99.78,
            end=100.22,
            t0=100.0,
            period=3.36,
        ),
        period=3.36,
        t0=100.0,
        fit_mode="bjd_window",
        bjd_start=99.78,
        bjd_end=100.22,
        fit_limb_darkening=True,
        baseline_order=1,
        sigma_clip_sigma=0.0,
        sigma_clip_iterations=0,
    )

    assert transit_fit_service._quadratic_ld_is_physical(
        result.fitted_params.u1,
        result.fitted_params.u2,
    )
    assert abs(result.fitted_params.u1 - 0.3) < 0.2
    assert abs(result.fitted_params.u2 - 0.2) < 0.2
    assert 6.0 <= result.fitted_params.a_rs <= 12.0
    assert 84.0 <= result.fitted_params.inclination <= 89.5


def test_fit_transit_model_requires_batman(monkeypatch):
    monkeypatch.setattr(transit_fit_service, "_HAS_BATMAN", False)
    monkeypatch.setattr(transit_fit_service, "_BATMAN_IMPORT_ERROR", None)

    try:
        transit_fit_service.fit_transit_model(
            points=_build_synthetic_points(),
            period=2.0,
            t0=1.0,
            fit_mode="bjd_window",
            bjd_start=0.82,
            bjd_end=1.18,
            fit_limb_darkening=False,
        )
    except ValueError as error:
        assert str(error) == "Transit fitting requires batman-package in the backend environment."
    else:
        raise AssertionError("Expected fit_transit_model to require batman")


def test_fit_transit_model_reports_batman_import_detail(monkeypatch):
    monkeypatch.setattr(transit_fit_service, "_HAS_BATMAN", False)
    monkeypatch.setattr(
        transit_fit_service,
        "_BATMAN_IMPORT_ERROR",
        "No module named 'batman'",
    )

    try:
        transit_fit_service.fit_transit_model(
            points=_build_synthetic_points(),
            period=2.0,
            t0=1.0,
            fit_mode="bjd_window",
            bjd_start=0.82,
            bjd_end=1.18,
            fit_limb_darkening=False,
        )
    except ValueError as error:
        assert (
            str(error)
            == "Transit fitting requires batman-package in the backend environment. "
            "Import error: No module named 'batman'"
        )
    else:
        raise AssertionError("Expected fit_transit_model to report batman import detail")


def test_runtime_dependency_status_reports_flags(monkeypatch):
    monkeypatch.setattr(transit_fit_service, "_HAS_BATMAN", False)
    monkeypatch.setattr(transit_fit_service, "_BATMAN_IMPORT_ERROR", "batman import failed")
    monkeypatch.setattr(transit_fit_service, "_HAS_EMCEE", True)
    monkeypatch.setattr(transit_fit_service, "_EMCEE_IMPORT_ERROR", None)
    monkeypatch.setattr(transit_fit_service, "_HAS_MEIDEM", True)
    monkeypatch.setattr(transit_fit_service, "_MEIDEM_IMPORT_ERROR", None)

    status = transit_fit_service.get_runtime_dependency_status()

    assert status == {
        "batman": {
            "available": False,
            "error": "batman import failed",
        },
        "emcee": {
            "available": True,
            "error": None,
        },
        "meidem": {
            "available": True,
            "error": None,
        },
    }
