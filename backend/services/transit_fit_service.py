from __future__ import annotations

import logging
from queue import Empty, Queue
from threading import Thread
from typing import Any, Callable, Generator

import numpy as np
from scipy.optimize import least_squares

from adapters.transit_archive import archive as transit_archive

logger = logging.getLogger(__name__)

try:
    # Python 3.12 removed distutils from the stdlib. batman still imports
    # distutils.ccompiler at runtime, so preload setuptools' compatibility shim.
    import setuptools  # noqa: F401
    import batman

    _HAS_BATMAN = True
    _BATMAN_IMPORT_ERROR: str | None = None
except Exception as error:
    _HAS_BATMAN = False
    _BATMAN_IMPORT_ERROR = str(error).strip() or error.__class__.__name__
    logger.warning("batman import failed: %s", _BATMAN_IMPORT_ERROR)

try:
    import emcee

    _HAS_EMCEE = True
    _EMCEE_IMPORT_ERROR: str | None = None
except Exception as error:
    _HAS_EMCEE = False
    _EMCEE_IMPORT_ERROR = str(error).strip() or error.__class__.__name__
    logger.warning("emcee import failed: %s", _EMCEE_IMPORT_ERROR)

try:
    import meidem

    _HAS_MEIDEM = True
    _MEIDEM_IMPORT_ERROR: str | None = None
except Exception as error:
    _HAS_MEIDEM = False
    _MEIDEM_IMPORT_ERROR = str(error).strip() or error.__class__.__name__
    logger.warning("meidem import failed: %s", _MEIDEM_IMPORT_ERROR)

from schemas.lightcurve import LightCurvePoint
from schemas.transit_fit import (
    TransitFitParameters,
    TransitFitPreprocessing,
    TransitFitResponse,
    TransitModelCurve,
)

_MODEL_PHASE_GRID = 4096
_MCMC_NWALKERS = 32
_MCMC_NSTEPS = 1500
_MCMC_BURN = 500
_MCMC_CHUNK = 100
_MIN_FIT_WINDOW_PHASE = 0.04
_MAX_FIT_WINDOW_PHASE = 0.35
_MAX_SIGMA_CLIP = 10.0
_MAX_SIGMA_ITERATIONS = 5
_MIN_EXPOSURE_PHASE = 1e-6
_MAX_EXPOSURE_PHASE = 0.03
_BATMAN_SUPERSAMPLE_FACTOR = 11
_A_RS_PRIOR_FRACTION = 0.45
_A_RS_PRIOR_FLOOR = 2.5
_INCLINATION_PRIOR_SIGMA = 3.0
_LD_PRIOR_SIGMA = 0.2
_DEFAULT_LD_SOURCE = "fixed_default"
_PHYSICAL_LD_EPS = 1e-4


def get_runtime_dependency_status() -> dict[str, dict[str, str | bool | None]]:
    return {
        "batman": {
            "available": _HAS_BATMAN,
            "error": _BATMAN_IMPORT_ERROR,
        },
        "emcee": {
            "available": _HAS_EMCEE,
            "error": _EMCEE_IMPORT_ERROR,
        },
        "meidem": {
            "available": _HAS_MEIDEM,
            "error": _MEIDEM_IMPORT_ERROR,
        },
    }


def _batman_missing_message() -> str:
    message = "Transit fitting requires batman-package in the backend environment."
    if _BATMAN_IMPORT_ERROR:
        return f"{message} Import error: {_BATMAN_IMPORT_ERROR}"
    return message

_FILTER_ALIASES = {
    "clear": "clear",
    "luminance": "luminance",
    "u": "JOHNSON_U",
    "johnson_u": "JOHNSON_U",
    "b": "JOHNSON_B",
    "johnson_b": "JOHNSON_B",
    "v": "JOHNSON_V",
    "johnson_v": "JOHNSON_V",
    "r": "COUSINS_R",
    "cousins_r": "COUSINS_R",
    "i": "COUSINS_I",
    "cousins_i": "COUSINS_I",
    "h": "2mass_h",
    "2mass_h": "2mass_h",
    "j": "2mass_j",
    "2mass_j": "2mass_j",
    "k": "2mass_ks",
    "ks": "2mass_ks",
    "2mass_k": "2mass_ks",
    "2mass_ks": "2mass_ks",
    "astrodon exoplanet-bb": "exoplanets_bb",
    "exoplanets_bb": "exoplanets_bb",
    "u'": "sdss_u",
    "sdss_u": "sdss_u",
    "g'": "sdss_g",
    "sdss_g": "sdss_g",
    "r'": "sdss_r",
    "sdss_r": "sdss_r",
    "i'": "sdss_i",
    "sdss_i": "sdss_i",
    "z'": "sdss_z",
    "sdss_z": "sdss_z",
    "kepler": "Kepler",
    "tess": "TESS",
}

_FILTER_LD_BASES: dict[str, tuple[float, float]] = {
    "TESS": (0.38, 0.22),
    "Kepler": (0.42, 0.22),
    "clear": (0.40, 0.22),
    "luminance": (0.40, 0.22),
    "exoplanets_bb": (0.40, 0.22),
    "JOHNSON_U": (0.62, 0.10),
    "JOHNSON_B": (0.55, 0.15),
    "JOHNSON_V": (0.47, 0.20),
    "COUSINS_R": (0.40, 0.22),
    "COUSINS_I": (0.31, 0.23),
    "sdss_u": (0.61, 0.11),
    "sdss_g": (0.52, 0.17),
    "sdss_r": (0.40, 0.22),
    "sdss_i": (0.31, 0.23),
    "sdss_z": (0.24, 0.22),
    "2mass_j": (0.18, 0.22),
    "2mass_h": (0.14, 0.20),
    "2mass_ks": (0.11, 0.18),
}

_MEIDEM_QUADRATIC_CONFIG: dict[str, dict[str, Any]] = {
    "TESS": {
        "passband": "TESS",
        "grid": "claret2017",
        "law": "quadratic",
        "mod": "A",
        "met": "L",
        "xi": 2.0,
        "source": "meidem_claret2017_quadratic",
    },
    "Kepler": {
        "passband": "Kp",
        "grid": "claret2011",
        "law": "quadratic",
        "xi": 2.0,
        "source": "meidem_claret2011_quadratic",
    },
}


def _notify_progress(
    progress_cb: Callable[[dict[str, Any]], None] | None,
    stage: str,
    pct: float,
    *,
    step: int | None = None,
    total: int | None = None,
) -> None:
    if progress_cb is None:
        return
    event: dict[str, Any] = {"stage": stage, "pct": float(np.clip(pct, 0.0, 1.0))}
    if step is not None:
        event["step"] = step
    if total is not None:
        event["total"] = total
    progress_cb(event)


def _coerce_optional_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        coerced = float(value)
    except (TypeError, ValueError):
        return None
    return coerced if np.isfinite(coerced) else None


def _normalize_filter_name(filter_name: str | None) -> str | None:
    if not filter_name:
        return None
    normalized = " ".join(str(filter_name).strip().split()).lower()
    return _FILTER_ALIASES.get(normalized, filter_name if filter_name in _FILTER_LD_BASES else None)


def _project_quadratic_ld_to_physical(u1: float, u2: float) -> tuple[float, float]:
    u1 = float(np.clip(u1, 0.0, 1.0 - (3.0 * _PHYSICAL_LD_EPS)))
    u2 = float(np.clip(u2, -0.5, 1.0))
    if u1 + u2 >= 1.0:
        u2 = 1.0 - u1 - _PHYSICAL_LD_EPS
    min_u2 = -0.5 * u1 + _PHYSICAL_LD_EPS
    if u2 <= min_u2:
        u2 = min_u2
    max_u2 = max(min_u2 + _PHYSICAL_LD_EPS, 1.0 - u1 - _PHYSICAL_LD_EPS)
    return float(u1), float(np.clip(u2, min_u2, max_u2))


def _fetch_target_stellar_context(
    target_id: str,
) -> tuple[float | None, float | None, float | None]:
    if not target_id:
        return None, None, None
    try:
        target = transit_archive.get_target(target_id)
    except Exception:
        target = None
    if not target:
        return None, None, None
    return (
        _coerce_optional_float(target.get("stellar_temperature")),
        _coerce_optional_float(target.get("stellar_logg")),
        _coerce_optional_float(target.get("stellar_metallicity")),
    )


def _resolve_quadratic_limb_darkening(
    *,
    target_id: str,
    filter_name: str | None,
    stellar_temperature: float | None,
    stellar_logg: float | None,
    stellar_metallicity: float | None,
) -> tuple[float, float, str, str | None]:
    resolved_filter = _normalize_filter_name(filter_name) or "TESS"
    base_u1, base_u2 = _FILTER_LD_BASES.get(resolved_filter, _FILTER_LD_BASES["TESS"])

    teff = _coerce_optional_float(stellar_temperature)
    logg = _coerce_optional_float(stellar_logg)
    metallicity = _coerce_optional_float(stellar_metallicity)
    if teff is None or logg is None or metallicity is None:
        archive_teff, archive_logg, archive_metallicity = _fetch_target_stellar_context(target_id)
        if teff is None:
            teff = archive_teff
        if logg is None:
            logg = archive_logg
        if metallicity is None:
            metallicity = archive_metallicity

    meidem_solution = _resolve_tabulated_quadratic_limb_darkening(
        resolved_filter=resolved_filter,
        teff=teff,
        logg=logg,
        metallicity=metallicity,
    )
    if meidem_solution is not None:
        return meidem_solution

    if teff is None or logg is None:
        u1, u2 = _project_quadratic_ld_to_physical(base_u1, base_u2)
        source = "filter_default" if resolved_filter in _FILTER_LD_BASES else _DEFAULT_LD_SOURCE
        return u1, u2, source, resolved_filter

    # HOPS uses ExoTETHyS tables. We mirror the same idea here by anchoring the
    # coefficients on the observing filter and gently adjusting them with the host
    # stellar parameters when a full table lookup is unavailable in this backend.
    teff_term = float(np.clip((5772.0 - teff) / 2500.0, -1.2, 1.2))
    logg_term = float(np.clip((logg - 4.4) / 0.8, -1.0, 1.0))
    metallicity_term = float(np.clip((metallicity or 0.0) / 0.5, -1.0, 1.0))

    u1 = base_u1 + (0.05 * teff_term) + (0.02 * logg_term) + (0.01 * metallicity_term)
    u2 = base_u2 - (0.02 * teff_term) + (0.01 * logg_term) + (0.01 * metallicity_term)
    u1, u2 = _project_quadratic_ld_to_physical(u1, u2)
    return u1, u2, "stellar_filter_heuristic", resolved_filter


def _resolve_tabulated_quadratic_limb_darkening(
    *,
    resolved_filter: str,
    teff: float | None,
    logg: float | None,
    metallicity: float | None,
) -> tuple[float, float, str, str | None] | None:
    if not _HAS_MEIDEM:
        return None
    if teff is None or logg is None or metallicity is None:
        return None

    config = _MEIDEM_QUADRATIC_CONFIG.get(resolved_filter)
    if config is None:
        return None

    try:
        result = meidem.get_ld_coefficients(
            teff=float(teff),
            logg=float(logg),
            feh=float(metallicity),
            passband=config["passband"],
            grid=config["grid"],
            law=config["law"],
            **({"mod": config["mod"]} if "mod" in config else {}),
            **({"met": config["met"]} if "met" in config else {}),
            **({"xi": config["xi"]} if "xi" in config else {}),
        )
    except Exception as error:
        logger.info(
            "meidem LD lookup failed for %s (Teff=%.1f logg=%.3f [Fe/H]=%.3f): %s",
            resolved_filter,
            float(teff),
            float(logg),
            float(metallicity),
            error,
        )
        return None

    coefficients = result.get("coefficients")
    if not isinstance(coefficients, (list, tuple)) or len(coefficients) != 2:
        return None

    u1, u2 = _project_quadratic_ld_to_physical(float(coefficients[0]), float(coefficients[1]))
    source = str(config.get("source") or result.get("grid") or "meidem_quadratic")
    filter_label = str(result.get("passband") or config["passband"])
    return u1, u2, source, filter_label


def fit_transit_model(
    points: list[LightCurvePoint],
    period: float,
    t0: float,
    target_id: str = "",
    filter_name: str | None = None,
    stellar_temperature: float | None = None,
    stellar_logg: float | None = None,
    stellar_metallicity: float | None = None,
    fit_mode: str = "phase_fold",
    bjd_start: float | None = None,
    bjd_end: float | None = None,
    fit_limb_darkening: bool = False,
    fit_window_phase: float = 0.12,
    baseline_order: int = 1,
    sigma_clip_sigma: float = 4.0,
    sigma_clip_iterations: int = 2,
    progress_cb: Callable[[dict[str, Any]], None] | None = None,
) -> TransitFitResponse:
    if not _HAS_BATMAN:
        raise ValueError(_batman_missing_message())
    _notify_progress(progress_cb, "init", 0.0)
    (
        times,
        phase,
        flux,
        error,
        t0,
        preprocessing,
        initial_params,
        u1_init,
        u2_init,
        exposure_phase,
    ) = _prepare_fit_series(
        points=points,
        period=period,
        t0=t0,
        target_id=target_id,
        filter_name=filter_name,
        stellar_temperature=stellar_temperature,
        stellar_logg=stellar_logg,
        stellar_metallicity=stellar_metallicity,
        fit_mode=fit_mode,
        bjd_start=bjd_start,
        bjd_end=bjd_end,
        fit_window_phase=fit_window_phase,
        baseline_order=baseline_order,
        sigma_clip_sigma=sigma_clip_sigma,
        sigma_clip_iterations=sigma_clip_iterations,
        progress_cb=progress_cb,
    )

    (
        fitted_params,
        fitted_t0,
        initial_curve,
        model_curve,
        model_time,
        residuals,
        used_mcmc,
    ) = _solve_fit(
        times=times,
        phase=phase,
        flux=flux,
        error=error,
        period=period,
        t0_reference=t0,
        initial_params=initial_params,
        u1_init=u1_init,
        u2_init=u2_init,
        exposure_phase=exposure_phase,
        fit_limb_darkening=fit_limb_darkening,
        progress_cb=progress_cb,
    )

    _notify_progress(progress_cb, "finalizing", 0.97)
    return TransitFitResponse(
        target_id=target_id,
        period=round(period, 8),
        t0=round(fitted_t0, 6),
        reference_t0=round(t0, 6),
        used_batman=_HAS_BATMAN,
        used_mcmc=used_mcmc,
        limb_darkening_source=preprocessing.limb_darkening_source,
        limb_darkening_filter=preprocessing.limb_darkening_filter,
        preprocessing=preprocessing,
        fitted_params=fitted_params,
        initial_params=initial_params,
        model_curve=model_curve,
        initial_curve=initial_curve,
        model_time=[round(float(value), 6) for value in model_time],
        data_time=[round(float(value), 6) for value in times],
        data_phase=[round(float(value), 6) for value in phase],
        data_flux=[round(float(value), 6) for value in flux],
        data_error=[round(float(value), 6) for value in error],
        residuals=[round(float(value), 6) for value in residuals],
    )


def fit_transit_model_streaming(
    points: list[LightCurvePoint],
    period: float,
    t0: float,
    target_id: str = "",
    filter_name: str | None = None,
    stellar_temperature: float | None = None,
    stellar_logg: float | None = None,
    stellar_metallicity: float | None = None,
    fit_mode: str = "phase_fold",
    bjd_start: float | None = None,
    bjd_end: float | None = None,
    fit_limb_darkening: bool = False,
    fit_window_phase: float = 0.12,
    baseline_order: int = 1,
    sigma_clip_sigma: float = 4.0,
    sigma_clip_iterations: int = 2,
) -> Generator[dict, None, None]:
    progress_queue: Queue[dict[str, Any]] = Queue()
    result_holder: dict[str, TransitFitResponse] = {}
    error_holder: dict[str, str] = {}

    def worker() -> None:
        try:
            result_holder["result"] = fit_transit_model(
                points=points,
                period=period,
                t0=t0,
                target_id=target_id,
                filter_name=filter_name,
                stellar_temperature=stellar_temperature,
                stellar_logg=stellar_logg,
                stellar_metallicity=stellar_metallicity,
                fit_mode=fit_mode,
                bjd_start=bjd_start,
                bjd_end=bjd_end,
                fit_limb_darkening=fit_limb_darkening,
                fit_window_phase=fit_window_phase,
                baseline_order=baseline_order,
                sigma_clip_sigma=sigma_clip_sigma,
                sigma_clip_iterations=sigma_clip_iterations,
                progress_cb=lambda event: progress_queue.put(event),
            )
        except Exception as error:  # pragma: no cover - surfaced to client
            error_holder["message"] = str(error)

    thread = Thread(target=worker, daemon=True)
    thread.start()

    while thread.is_alive() or not progress_queue.empty():
        try:
            event = progress_queue.get(timeout=0.2)
        except Empty:
            continue
        yield {"type": "progress", **event}

    if "message" in error_holder:
        yield {"type": "error", "message": error_holder["message"]}
        return

    result = result_holder.get("result")
    if result is None:
        yield {"type": "error", "message": "Transit model fitting returned no result."}
        return

    yield {"type": "result", "data": result}


def _prepare_fit_series(
    *,
    points: list[LightCurvePoint],
    period: float,
    t0: float,
    target_id: str,
    filter_name: str | None,
    stellar_temperature: float | None,
    stellar_logg: float | None,
    stellar_metallicity: float | None,
    fit_mode: str,
    bjd_start: float | None,
    bjd_end: float | None,
    fit_window_phase: float,
    baseline_order: int,
    sigma_clip_sigma: float,
    sigma_clip_iterations: int,
    progress_cb: Callable[[dict[str, Any]], None] | None = None,
) -> tuple[
    np.ndarray,
    np.ndarray,
    np.ndarray,
    np.ndarray,
    float,
    TransitFitPreprocessing,
    TransitFitParameters,
    float,
    float,
    float,
]:
    if period <= 0:
        raise ValueError("Transit fit requires a positive orbital period.")
    if len(points) < 20:
        raise ValueError("Transit fit requires at least 20 light-curve points.")

    fit_mode = "bjd_window" if fit_mode == "bjd_window" else "phase_fold"
    fit_window_phase = float(np.clip(fit_window_phase, _MIN_FIT_WINDOW_PHASE, _MAX_FIT_WINDOW_PHASE))
    baseline_order = 1 if int(baseline_order) > 0 else 0
    sigma_clip_sigma = float(np.clip(sigma_clip_sigma, 0.0, _MAX_SIGMA_CLIP))
    sigma_clip_iterations = int(np.clip(sigma_clip_iterations, 0, _MAX_SIGMA_ITERATIONS))

    times = np.asarray([point.hjd for point in points], dtype=float)
    flux = np.asarray([point.magnitude for point in points], dtype=float)
    error = np.asarray([max(point.mag_error, 5e-4) for point in points], dtype=float)

    finite_mask = np.isfinite(times) & np.isfinite(flux) & np.isfinite(error) & (error > 0)
    if finite_mask.sum() < 20:
        raise ValueError("Transit fit requires at least 20 finite light-curve points.")

    times = times[finite_mask]
    flux = flux[finite_mask]
    error = error[finite_mask]

    resolved_bjd_start = None
    resolved_bjd_end = None
    if fit_mode == "bjd_window":
        if bjd_start is None or bjd_end is None:
            raise ValueError("BJD window fitting requires both start and end times.")
        resolved_bjd_start = float(min(bjd_start, bjd_end))
        resolved_bjd_end = float(max(bjd_start, bjd_end))
        if not np.isfinite(resolved_bjd_start) or not np.isfinite(resolved_bjd_end):
            raise ValueError("BJD window limits must be finite numbers.")
        if resolved_bjd_end <= resolved_bjd_start:
            raise ValueError("BJD window end time must be greater than the start time.")
        window_mask = (times >= resolved_bjd_start) & (times <= resolved_bjd_end)
        if window_mask.sum() < 20:
            raise ValueError("BJD window retained too few points for transit fitting.")
        times = times[window_mask]
        flux = flux[window_mask]
        error = error[window_mask]

    exposure_phase = _estimate_exposure_phase(times, period)

    phase = _compute_phase(times, period, t0)
    dip_phase = _find_dip_phase(phase, flux)
    if abs(dip_phase) > 1e-4:
        t0 = float(t0 + dip_phase * period)
        phase = _compute_phase(times, period, t0)
    _notify_progress(progress_cb, "phase_fold", 0.08)

    if fit_mode == "phase_fold":
        effective_fit_window = float(np.clip(fit_window_phase, _MIN_FIT_WINDOW_PHASE, _MAX_FIT_WINDOW_PHASE))
        fit_mask = np.abs(phase) <= effective_fit_window
        if fit_mask.sum() >= 20:
            times = times[fit_mask]
            phase = phase[fit_mask]
            flux = flux[fit_mask]
            error = error[fit_mask]
        phase_fit = phase
        flux_fit = flux
        error_fit = error
        exclusion_phase = min(
            max(effective_fit_window * 0.6, 0.02),
            max(effective_fit_window * 0.9, 0.02),
        )
        oot_mask = np.abs(phase_fit) >= exclusion_phase
        baseline_x = phase_fit / max(effective_fit_window, 1e-6)
        preprocessing_fit_window = effective_fit_window
    else:
        phase_fit = phase
        flux_fit = flux
        error_fit = error
        baseline_x = _window_baseline_coordinate(times)
        phase_half_span = float(np.nanmax(np.abs(phase_fit))) if phase_fit.size else 0.0
        effective_fit_window = float(
            np.clip(max(fit_window_phase, phase_half_span), _MIN_FIT_WINDOW_PHASE, _MAX_FIT_WINDOW_PHASE)
        )
        phase_oot_mask = np.abs(phase_fit) >= min(max(effective_fit_window * 0.6, 0.02), 0.2)
        oot_mask = (np.abs(baseline_x) >= 0.35) | phase_oot_mask
        preprocessing_fit_window = effective_fit_window

    if oot_mask.sum() < 3:
        oot_mask = np.ones_like(phase_fit, dtype=bool)

    flux_fit, error_fit = _normalize_with_baseline(
        x=baseline_x,
        flux=flux_fit,
        error=error_fit,
        mask=oot_mask,
        order=baseline_order,
    )

    keep_mask = np.ones_like(phase_fit, dtype=bool)
    clipped_points = 0
    if sigma_clip_sigma > 0 and sigma_clip_iterations > 0:
        keep_mask, clipped_points = _sigma_clip_out_of_transit(
            flux=flux_fit,
            mask=oot_mask,
            sigma=sigma_clip_sigma,
            iterations=sigma_clip_iterations,
        )
        times = times[keep_mask]
        phase_fit = phase_fit[keep_mask]
        flux_fit = flux_fit[keep_mask]
        error_fit = error_fit[keep_mask]
        oot_mask = oot_mask[keep_mask]
        baseline_x = baseline_x[keep_mask]

    if phase_fit.size < 10:
        raise ValueError("Transit fit retained too few points after preprocessing.")

    oot_flux = flux_fit[oot_mask]
    baseline_level = np.nanmedian(oot_flux) if oot_flux.size else np.nanmedian(flux_fit)
    if np.isfinite(baseline_level) and baseline_level > 0:
        flux_fit = flux_fit / baseline_level
        error_fit = error_fit / baseline_level
    empirical_error = _estimate_empirical_point_error(flux_fit, oot_mask)
    if np.isfinite(empirical_error) and empirical_error > 0:
        error_fit = np.full_like(error_fit, max(empirical_error, 5e-4))
    _notify_progress(progress_cb, "preprocess", 0.18)

    depth_guess = float(np.clip(1.0 - np.nanmin(flux_fit), 0.001, 0.25))
    rp_rs_init = float(np.clip(np.sqrt(depth_guess), 0.02, 0.4))
    a_rs_init = _estimate_a_rs_from_duration(phase_fit, flux_fit) or 8.0
    inclination_init = 88.0
    (
        u1_init,
        u2_init,
        ld_source,
        ld_filter,
    ) = _resolve_quadratic_limb_darkening(
        target_id=target_id,
        filter_name=filter_name,
        stellar_temperature=stellar_temperature,
        stellar_logg=stellar_logg,
        stellar_metallicity=stellar_metallicity,
    )

    initial_model = _evaluate_model(
        phase_fit,
        rp_rs_init,
        a_rs_init,
        inclination_init,
        u1_init,
        u2_init,
        exposure_phase,
    )
    initial_params = _build_fit_parameters(
        rp_rs=rp_rs_init,
        a_rs=a_rs_init,
        inclination=inclination_init,
        u1=u1_init,
        u2=u2_init,
        flux=flux_fit,
        error=error_fit,
        model_flux=initial_model,
    )

    preprocessing = TransitFitPreprocessing(
        fit_mode=fit_mode,
        fit_window_phase=round(preprocessing_fit_window, 4),
        bjd_start=round(resolved_bjd_start, 6) if resolved_bjd_start is not None else None,
        bjd_end=round(resolved_bjd_end, 6) if resolved_bjd_end is not None else None,
        limb_darkening_source=ld_source,
        limb_darkening_filter=ld_filter,
        baseline_order=baseline_order,
        sigma_clip_sigma=round(sigma_clip_sigma, 2),
        sigma_clip_iterations=sigma_clip_iterations,
        retained_points=int(phase_fit.size),
        clipped_points=int(clipped_points),
    )

    return (
        times,
        phase_fit,
        flux_fit,
        error_fit,
        t0,
        preprocessing,
        initial_params,
        u1_init,
        u2_init,
        exposure_phase,
    )


def _solve_fit(
    *,
    times: np.ndarray,
    phase: np.ndarray,
    flux: np.ndarray,
    error: np.ndarray,
    period: float,
    t0_reference: float,
    initial_params: TransitFitParameters,
    u1_init: float,
    u2_init: float,
    exposure_phase: float,
    fit_limb_darkening: bool,
    progress_cb: Callable[[dict[str, Any]], None] | None = None,
) -> tuple[
    TransitFitParameters,
    float,
    TransitModelCurve,
    TransitModelCurve,
    np.ndarray,
    np.ndarray,
    bool,
]:
    _notify_progress(progress_cb, "least_squares", 0.35)
    shift_limit = float(np.clip(np.nanmax(np.abs(phase)), 0.02, 0.35))
    impact_init = _inclination_to_impact_parameter(
        initial_params.a_rs,
        initial_params.inclination,
    )

    if fit_limb_darkening:
        initial_vector = np.array(
            [
                initial_params.rp_rs,
                initial_params.a_rs,
                impact_init,
                0.0,
                u1_init,
                u2_init,
            ],
            dtype=float,
        )
        lower = np.array([0.001, 2.0, 0.0, -shift_limit, 0.0, -0.5], dtype=float)
        upper = np.array([0.5, 50.0, 1.5, shift_limit, 1.0, 1.0], dtype=float)
    else:
        initial_vector = np.array(
            [initial_params.rp_rs, initial_params.a_rs, impact_init, 0.0],
            dtype=float,
        )
        lower = np.array([0.001, 2.0, 0.0, -shift_limit], dtype=float)
        upper = np.array([0.5, 50.0, 1.5, shift_limit], dtype=float)

    def residual_function(params: np.ndarray) -> np.ndarray:
        if fit_limb_darkening:
            rp_rs, a_rs, impact_b, phase_offset, u1, u2 = params
        else:
            rp_rs, a_rs, impact_b, phase_offset = params
            u1, u2 = u1_init, u2_init
        if impact_b < 0.0 or impact_b >= a_rs:
            prior_residuals = np.zeros(4 if fit_limb_darkening else 2, dtype=float)
            return np.full(phase.size + prior_residuals.size, 1e6, dtype=float)
        inclination = _impact_parameter_to_inclination_deg(a_rs, impact_b)
        prior_residuals = _build_soft_prior_residuals(
            a_rs=a_rs,
            inclination=inclination,
            initial_params=initial_params,
            fit_limb_darkening=fit_limb_darkening,
            u1=u1,
            u2=u2,
            u1_init=u1_init,
            u2_init=u2_init,
        )
        if fit_limb_darkening and not _quadratic_ld_is_physical(u1, u2):
            return np.full(phase.size + prior_residuals.size, 1e6, dtype=float)
        model = _evaluate_model(
            phase - phase_offset,
            rp_rs,
            a_rs,
            inclination,
            u1,
            u2,
            exposure_phase,
        )
        data_residuals = (flux - model) / np.maximum(error, 1e-6)
        return np.concatenate([data_residuals, prior_residuals])

    least_squares_result = least_squares(
        residual_function,
        initial_vector,
        bounds=(lower, upper),
        method="trf",
        loss="soft_l1",
        f_scale=1.0,
        max_nfev=300,
    )
    _notify_progress(progress_cb, "least_squares", 0.52)

    ls_vector = least_squares_result.x
    ls_uncertainty = _estimate_least_squares_uncertainty(least_squares_result)
    final_vector = ls_vector
    final_uncertainty = ls_uncertainty
    used_mcmc = False

    if _HAS_EMCEE:
        try:
            final_vector, final_uncertainty = _run_mcmc(
                phase=phase,
                flux=flux,
                error=error,
                initial=ls_vector,
                fit_limb_darkening=fit_limb_darkening,
                initial_params=initial_params,
                u1_fixed=u1_init,
                u2_fixed=u2_init,
                exposure_phase=exposure_phase,
                shift_limit=shift_limit,
                progress_cb=lambda step, total: _notify_progress(
                    progress_cb,
                    "mcmc",
                    0.55 + 0.35 * (step / max(total, 1)),
                    step=step,
                    total=total,
                ),
            )
            used_mcmc = True
        except Exception:
            final_vector = ls_vector
            final_uncertainty = ls_uncertainty
            used_mcmc = False

    if fit_limb_darkening:
        rp_rs, a_rs, impact_b, phase_offset, u1, u2 = final_vector
        rp_err, a_err, impact_err, _phase_err, u1_err, u2_err = final_uncertainty
        param_count = 6
    else:
        rp_rs, a_rs, impact_b, phase_offset = final_vector
        u1, u2 = u1_init, u2_init
        rp_err, a_err, impact_err, _phase_err = final_uncertainty
        u1_err = 0.0
        u2_err = 0.0
        param_count = 4
    inclination = _impact_parameter_to_inclination_deg(a_rs, impact_b)
    inc_err = _impact_parameter_uncertainty_to_inclination(
        a_rs,
        impact_b,
        impact_err,
    )

    best_flux = _evaluate_model(
        phase - phase_offset,
        rp_rs,
        a_rs,
        inclination,
        u1,
        u2,
        exposure_phase,
    )
    residuals = flux - best_flux
    fitted_t0 = float(t0_reference + phase_offset * period)

    fitted_params = _build_fit_parameters(
        rp_rs=rp_rs,
        a_rs=a_rs,
        inclination=inclination,
        u1=u1,
        u2=u2,
        flux=flux,
        error=error,
        model_flux=best_flux,
        rp_err=rp_err,
        a_err=a_err,
        inclination_err=inc_err,
        u1_err=u1_err,
        u2_err=u2_err,
        param_count=param_count,
    )

    initial_curve = _build_model_curve(
        initial_params.rp_rs,
        initial_params.a_rs,
        initial_params.inclination,
        initial_params.u1,
        initial_params.u2,
        exposure_phase,
        0.0,
    )
    model_curve = _build_model_curve(
        rp_rs,
        a_rs,
        inclination,
        u1,
        u2,
        exposure_phase,
        float(phase_offset),
    )
    model_time = np.asarray(
        [t0_reference + phase_value * period for phase_value in model_curve.phase],
        dtype=float,
    )

    return fitted_params, fitted_t0, initial_curve, model_curve, model_time, residuals, used_mcmc


def _compute_phase(times: np.ndarray, period: float, t0: float) -> np.ndarray:
    return ((times - t0 + 0.5 * period) % period) / period - 0.5


def _quadratic_ld_is_physical(u1: float, u2: float) -> bool:
    return u1 >= 0.0 and (u1 + u2) <= 1.0 and (u1 + 2.0 * u2) >= 0.0


def _build_soft_prior_residuals(
    *,
    a_rs: float,
    inclination: float,
    initial_params: TransitFitParameters,
    fit_limb_darkening: bool,
    u1: float,
    u2: float,
    u1_init: float,
    u2_init: float,
) -> np.ndarray:
    a_rs_sigma = max(_A_RS_PRIOR_FLOOR, initial_params.a_rs * _A_RS_PRIOR_FRACTION)
    prior_terms = [
        (a_rs - initial_params.a_rs) / a_rs_sigma,
        (inclination - initial_params.inclination) / _INCLINATION_PRIOR_SIGMA,
    ]
    if fit_limb_darkening:
        prior_terms.extend(
            [
                (u1 - u1_init) / _LD_PRIOR_SIGMA,
                (u2 - u2_init) / _LD_PRIOR_SIGMA,
            ]
        )
    return np.asarray(prior_terms, dtype=float)


def _log_gaussian_prior(value: float, center: float, sigma: float) -> float:
    sigma = max(float(sigma), 1e-6)
    return -0.5 * ((float(value) - float(center)) / sigma) ** 2


def _log_soft_prior(
    *,
    a_rs: float,
    inclination: float,
    initial_params: TransitFitParameters,
    fit_limb_darkening: bool,
    u1: float,
    u2: float,
    u1_init: float,
    u2_init: float,
) -> float:
    if fit_limb_darkening and not _quadratic_ld_is_physical(u1, u2):
        return -np.inf

    a_rs_sigma = max(_A_RS_PRIOR_FLOOR, initial_params.a_rs * _A_RS_PRIOR_FRACTION)
    log_prior = _log_gaussian_prior(a_rs, initial_params.a_rs, a_rs_sigma)
    log_prior += _log_gaussian_prior(
        inclination,
        initial_params.inclination,
        _INCLINATION_PRIOR_SIGMA,
    )
    if fit_limb_darkening:
        log_prior += _log_gaussian_prior(u1, u1_init, _LD_PRIOR_SIGMA)
        log_prior += _log_gaussian_prior(u2, u2_init, _LD_PRIOR_SIGMA)
    return float(log_prior)


def _fit_baseline(
    *,
    x: np.ndarray,
    flux: np.ndarray,
    error: np.ndarray,
    mask: np.ndarray,
    order: int,
) -> np.ndarray:
    safe_flux = flux[mask] if mask.any() else flux
    baseline_level = np.nanmedian(safe_flux)
    if order <= 0 or mask.sum() < 3:
        return np.full_like(flux, baseline_level if np.isfinite(baseline_level) else 1.0)

    coeffs = np.polyfit(
        x[mask],
        flux[mask],
        deg=1,
        w=1.0 / np.maximum(error[mask], 1e-5),
    )
    baseline = np.polyval(coeffs, x)
    if not np.all(np.isfinite(baseline)):
        return np.full_like(flux, baseline_level if np.isfinite(baseline_level) else 1.0)
    return baseline


def _normalize_with_baseline(
    *,
    x: np.ndarray,
    flux: np.ndarray,
    error: np.ndarray,
    mask: np.ndarray,
    order: int,
) -> tuple[np.ndarray, np.ndarray]:
    baseline = _fit_baseline(x=x, flux=flux, error=error, mask=mask, order=order)
    fallback_level = np.nanmedian(flux[mask]) if mask.any() else np.nanmedian(flux)
    if not np.isfinite(fallback_level) or fallback_level <= 0:
        fallback_level = 1.0
    safe_baseline = np.where(np.isfinite(baseline) & (baseline > 0), baseline, fallback_level)
    return flux / safe_baseline, error / safe_baseline


def _window_baseline_coordinate(times: np.ndarray) -> np.ndarray:
    if times.size == 0:
        return np.asarray([], dtype=float)
    center = float(0.5 * (np.nanmin(times) + np.nanmax(times)))
    half_width = max(float(0.5 * (np.nanmax(times) - np.nanmin(times))), 1e-6)
    return (times - center) / half_width


def _estimate_exposure_phase(times: np.ndarray, period: float) -> float:
    if times.size < 2 or period <= 0:
        return 0.001
    diffs = np.diff(np.sort(times))
    diffs = diffs[np.isfinite(diffs) & (diffs > 0)]
    if diffs.size == 0:
        return 0.001
    cadence_days = float(np.nanmedian(diffs))
    if not np.isfinite(cadence_days) or cadence_days <= 0:
        return 0.001
    return float(np.clip(cadence_days / period, _MIN_EXPOSURE_PHASE, _MAX_EXPOSURE_PHASE))


def _sigma_clip_out_of_transit(
    *,
    flux: np.ndarray,
    mask: np.ndarray,
    sigma: float,
    iterations: int,
) -> tuple[np.ndarray, int]:
    keep_mask = np.ones_like(flux, dtype=bool)
    clipped_total = 0
    for _ in range(iterations):
        sample = flux[keep_mask & mask]
        if sample.size < 6:
            break
        center = float(np.nanmedian(sample))
        scatter = _robust_sigma(sample - center)
        if not np.isfinite(scatter) or scatter <= 0:
            break
        reject_mask = mask & (np.abs(flux - center) > sigma * scatter)
        next_keep = keep_mask & ~reject_mask
        removed = int(keep_mask.sum() - next_keep.sum())
        if removed <= 0:
            break
        keep_mask = next_keep
        clipped_total += removed
    return keep_mask, clipped_total


def _robust_sigma(values: np.ndarray) -> float:
    if values.size == 0:
        return 0.0
    median = np.nanmedian(values)
    mad = np.nanmedian(np.abs(values - median))
    if not np.isfinite(mad) or mad <= 0:
        return float(np.nanstd(values))
    return float(1.4826 * mad)


def _estimate_empirical_point_error(flux: np.ndarray, oot_mask: np.ndarray) -> float:
    sample = flux[oot_mask] if oot_mask.any() else flux
    sample = sample[np.isfinite(sample)]
    if sample.size < 3:
        return 0.0
    center = float(np.nanmedian(sample))
    scatter = _robust_sigma(sample - center)
    if np.isfinite(scatter) and scatter > 0:
        return float(scatter)
    return float(np.nanstd(sample))


def _estimate_least_squares_uncertainty(least_squares_result: Any) -> np.ndarray:
    try:
        jacobian = least_squares_result.jac
        if jacobian is None or jacobian.size == 0:
            return np.zeros(len(least_squares_result.x))
        _, singular_values, vt = np.linalg.svd(jacobian, full_matrices=False)
        threshold = np.finfo(float).eps * max(jacobian.shape) * singular_values[0]
        singular_values = singular_values[singular_values > threshold]
        vt = vt[: singular_values.size]
        covariance = (vt.T / (singular_values**2)) @ vt
        dof = max(len(least_squares_result.fun) - len(least_squares_result.x), 1)
        chi2_reduced = (2.0 * least_squares_result.cost) / dof
        variance = np.clip(np.diag(covariance) * chi2_reduced, 0.0, None)
        return np.sqrt(variance)
    except Exception:
        return np.zeros(len(least_squares_result.x))


def _build_fit_parameters(
    *,
    rp_rs: float,
    a_rs: float,
    inclination: float,
    u1: float,
    u2: float,
    flux: np.ndarray,
    error: np.ndarray,
    model_flux: np.ndarray,
    rp_err: float = 0.0,
    a_err: float = 0.0,
    inclination_err: float = 0.0,
    u1_err: float = 0.0,
    u2_err: float = 0.0,
    param_count: int = 5,
) -> TransitFitParameters:
    residuals = flux - model_flux
    chi_squared = float(np.sum((residuals / np.maximum(error, 1e-6)) ** 2))
    degrees_of_freedom = max(int(flux.size) - int(param_count), 1)
    reduced = chi_squared / degrees_of_freedom
    return TransitFitParameters(
        rp_rs=round(float(rp_rs), 5),
        rp_rs_err=round(float(abs(rp_err)), 5),
        a_rs=round(float(a_rs), 2),
        a_rs_err=round(float(abs(a_err)), 2),
        inclination=round(float(inclination), 2),
        inclination_err=round(float(abs(inclination_err)), 2),
        u1=round(float(u1), 3),
        u1_err=round(float(abs(u1_err)), 3),
        u2=round(float(u2), 3),
        u2_err=round(float(abs(u2_err)), 3),
        chi_squared=round(chi_squared, 3),
        reduced_chi_squared=round(float(reduced), 3),
        degrees_of_freedom=degrees_of_freedom,
    )


def _build_model_curve(
    rp_rs: float,
    a_rs: float,
    inclination: float,
    u1: float,
    u2: float,
    exposure_phase: float,
    phase_offset: float,
) -> TransitModelCurve:
    phase_grid = np.linspace(-0.5, 0.5, _MODEL_PHASE_GRID)
    model_flux = _evaluate_model(
        phase_grid - phase_offset,
        rp_rs,
        a_rs,
        inclination,
        u1,
        u2,
        exposure_phase,
    )
    return TransitModelCurve(
        phase=[round(float(value), 6) for value in phase_grid],
        flux=[round(float(value), 6) for value in model_flux],
    )


def _inclination_to_impact_parameter(a_rs: float, inclination: float) -> float:
    safe_a_rs = max(float(a_rs), 1e-6)
    safe_inclination = float(np.clip(inclination, 0.0, 90.0))
    return float(np.clip(safe_a_rs * np.cos(np.radians(safe_inclination)), 0.0, safe_a_rs - 1e-6))


def _impact_parameter_to_inclination_deg(a_rs: float, impact_b: float) -> float:
    safe_a_rs = max(float(a_rs), 1e-6)
    ratio = float(np.clip(impact_b / safe_a_rs, 0.0, 1.0))
    return float(np.degrees(np.arccos(ratio)))


def _impact_parameter_uncertainty_to_inclination(
    a_rs: float,
    impact_b: float,
    impact_err: float,
) -> float:
    if not np.isfinite(impact_err) or impact_err <= 0:
        return 0.0
    safe_a_rs = max(float(a_rs), 1e-6)
    lower_b = float(np.clip(impact_b - impact_err, 0.0, safe_a_rs - 1e-6))
    upper_b = float(np.clip(impact_b + impact_err, 0.0, safe_a_rs - 1e-6))
    center_inc = _impact_parameter_to_inclination_deg(safe_a_rs, impact_b)
    lower_inc = _impact_parameter_to_inclination_deg(safe_a_rs, lower_b)
    upper_inc = _impact_parameter_to_inclination_deg(safe_a_rs, upper_b)
    return float(max(abs(center_inc - lower_inc), abs(center_inc - upper_inc)))


def _run_mcmc(
    phase: np.ndarray,
    flux: np.ndarray,
    error: np.ndarray,
    initial: np.ndarray,
    fit_limb_darkening: bool,
    initial_params: TransitFitParameters,
    u1_fixed: float,
    u2_fixed: float,
    exposure_phase: float,
    shift_limit: float,
    progress_cb: Callable[[int, int], None] | None = None,
) -> tuple[np.ndarray, np.ndarray]:
    ndim = len(initial)

    if fit_limb_darkening:
        bounds_lower = np.array([0.001, 2.0, 0.0, -shift_limit, 0.0, -0.5])
        bounds_upper = np.array([0.5, 50.0, 1.5, shift_limit, 1.0, 1.0])
    else:
        bounds_lower = np.array([0.001, 2.0, 0.0, -shift_limit])
        bounds_upper = np.array([0.5, 50.0, 1.5, shift_limit])

    def log_prior(params: np.ndarray) -> float:
        if np.any(params < bounds_lower) or np.any(params > bounds_upper):
            return -np.inf
        if fit_limb_darkening:
            _rp_rs, a_rs, impact_b, _phase_offset, u1, u2 = params
        else:
            _rp_rs, a_rs, impact_b, _phase_offset = params
            u1, u2 = u1_fixed, u2_fixed
        if impact_b < 0.0 or impact_b >= a_rs:
            return -np.inf
        inclination = _impact_parameter_to_inclination_deg(a_rs, impact_b)
        return _log_soft_prior(
            a_rs=a_rs,
            inclination=inclination,
            initial_params=initial_params,
            fit_limb_darkening=fit_limb_darkening,
            u1=u1,
            u2=u2,
            u1_init=u1_fixed,
            u2_init=u2_fixed,
        )

    def log_likelihood(params: np.ndarray) -> float:
        if fit_limb_darkening:
            rp_rs, a_rs, impact_b, phase_offset, u1, u2 = params
        else:
            rp_rs, a_rs, impact_b, phase_offset = params
            u1, u2 = u1_fixed, u2_fixed
        if impact_b < 0.0 or impact_b >= a_rs:
            return -np.inf
        inclination = _impact_parameter_to_inclination_deg(a_rs, impact_b)
        model = _evaluate_model(
            phase - phase_offset,
            rp_rs,
            a_rs,
            inclination,
            u1,
            u2,
            exposure_phase,
        )
        return -0.5 * np.sum(((flux - model) / np.maximum(error, 1e-6)) ** 2)

    def log_probability(params: np.ndarray) -> float:
        prior = log_prior(params)
        if not np.isfinite(prior):
            return -np.inf
        likelihood = log_likelihood(params)
        if not np.isfinite(likelihood):
            return -np.inf
        return prior + likelihood

    scatter = np.abs(initial) * 0.01 + 1e-5
    positions = initial + scatter * np.random.randn(_MCMC_NWALKERS, ndim)
    positions = np.clip(positions, bounds_lower + 1e-6, bounds_upper - 1e-6)

    sampler = emcee.EnsembleSampler(_MCMC_NWALKERS, ndim, log_probability)
    n_chunks = max(1, _MCMC_NSTEPS // _MCMC_CHUNK)
    steps_per_chunk = _MCMC_NSTEPS // n_chunks
    for chunk_index in range(n_chunks):
        sampler.run_mcmc(
            positions if chunk_index == 0 else None,
            steps_per_chunk,
            progress=False,
        )
        if progress_cb is not None:
            progress_cb(chunk_index + 1, n_chunks)

    flat_samples = sampler.get_chain(discard=_MCMC_BURN, flat=True)
    if flat_samples.shape[0] == 0:
        return initial, np.zeros(ndim)
    flat_log_prob = sampler.get_log_prob(discard=_MCMC_BURN, flat=True)
    if flat_log_prob.shape[0] != flat_samples.shape[0]:
        return np.median(flat_samples, axis=0), np.std(flat_samples, axis=0)
    best_index = int(np.nanargmax(flat_log_prob))
    return flat_samples[best_index], np.std(flat_samples, axis=0)


def _evaluate_model(
    phase: np.ndarray,
    rp_rs: float,
    a_rs: float,
    inclination: float,
    u1: float,
    u2: float,
    exposure_phase: float = 0.001,
) -> np.ndarray:
    if _HAS_BATMAN:
        return _evaluate_batman(phase, rp_rs, a_rs, inclination, u1, u2, exposure_phase)
    return _evaluate_simple(phase, rp_rs, a_rs, inclination)


def _evaluate_batman(
    phase: np.ndarray,
    rp_rs: float,
    a_rs: float,
    inclination: float,
    u1: float,
    u2: float,
    exposure_phase: float,
) -> np.ndarray:
    params = batman.TransitParams()
    params.t0 = 0.0
    params.per = 1.0
    params.rp = float(np.clip(rp_rs, 0.001, 0.5))
    params.a = float(np.clip(a_rs, 1.5, 50.0))
    params.inc = float(np.clip(inclination, 60.0, 90.0))
    params.ecc = 0.0
    params.w = 90.0
    params.u = [float(u1), float(u2)]
    params.limb_dark = "quadratic"
    exp_time = float(np.clip(exposure_phase, _MIN_EXPOSURE_PHASE, _MAX_EXPOSURE_PHASE))
    return batman.TransitModel(
        params,
        np.asarray(phase, dtype=np.float64),
        supersample_factor=_BATMAN_SUPERSAMPLE_FACTOR,
        exp_time=exp_time,
    ).light_curve(params)


def _evaluate_simple(
    phase: np.ndarray,
    rp_rs: float,
    a_rs: float,
    inclination: float,
) -> np.ndarray:
    inc_rad = np.radians(inclination)
    sin_inc = max(np.sin(inc_rad), 1e-4)
    impact = a_rs * np.cos(inc_rad)
    numerator = max((1 + rp_rs) ** 2 - impact**2, 0.0)
    duration_phase = (1.0 / np.pi) * np.arcsin(np.sqrt(numerator) / max(a_rs * sin_inc, 1e-4))
    depth = rp_rs**2
    model = np.ones_like(phase)
    in_transit = np.abs(phase) < max(duration_phase, 0.01)
    model[in_transit] = 1.0 - depth
    return model


def _estimate_a_rs_from_duration(phase: np.ndarray, flux: np.ndarray) -> float | None:
    n_bins = 100
    bin_edges = np.linspace(-0.5, 0.5, n_bins + 1)
    bin_centers = 0.5 * (bin_edges[:-1] + bin_edges[1:])
    bin_flux = np.full(n_bins, np.nan)

    for index in range(n_bins):
        mask = (phase >= bin_edges[index]) & (phase < bin_edges[index + 1])
        if mask.sum() >= 2:
            bin_flux[index] = np.nanmedian(flux[mask])

    finite = np.isfinite(bin_flux)
    if finite.sum() < 10:
        return None

    baseline = np.nanmedian(bin_flux[finite])
    dip = baseline - np.nanmin(bin_flux[finite])
    if dip < 0.0005:
        return None

    threshold = baseline - dip * 0.5
    in_transit = bin_flux < threshold
    if not in_transit.any():
        return None

    transit_bins = np.where(in_transit)[0]
    near_zero = transit_bins[np.abs(bin_centers[transit_bins]) < 0.25]
    if len(near_zero) < 2:
        return None

    duration_phase = float(bin_centers[near_zero[-1]] - bin_centers[near_zero[0]])
    if duration_phase <= 0.005 or duration_phase > 0.2:
        return None

    a_rs = 1.0 / (duration_phase * np.pi)
    return float(np.clip(a_rs, 3.0, 30.0))


def _find_dip_phase(phase: np.ndarray, flux: np.ndarray) -> float:
    finite_mask = np.isfinite(phase) & np.isfinite(flux)
    if finite_mask.sum() < 6:
        return 0.0

    phase = phase[finite_mask]
    flux = flux[finite_mask]
    baseline = float(np.nanmedian(flux))
    scatter = _robust_sigma(flux - baseline)
    if not np.isfinite(scatter) or scatter <= 0:
        scatter = float(np.nanstd(flux))
    if not np.isfinite(scatter) or scatter <= 0:
        return 0.0

    sample_count = int(np.clip(np.ceil(phase.size * 0.2), 3, 15))
    deepest_indices = np.argsort(flux)[:sample_count]
    dip_flux = flux[deepest_indices]
    dip_phase = float(np.nanmedian(phase[deepest_indices]))
    dip_depth = baseline - float(np.nanmedian(dip_flux))
    if dip_depth < 2 * scatter:
        return 0.0
    return float(np.clip(dip_phase, -0.25, 0.25))
