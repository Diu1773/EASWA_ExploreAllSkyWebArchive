from __future__ import annotations

import numpy as np
from scipy.optimize import least_squares

try:
    import batman
    _HAS_BATMAN = True
except ImportError:
    _HAS_BATMAN = False

try:
    import emcee
    _HAS_EMCEE = True
except ImportError:
    _HAS_EMCEE = False

from schemas.lightcurve import LightCurvePoint
from schemas.transit_fit import (
    TransitFitParameters,
    TransitFitResponse,
    TransitModelCurve,
)

_MODEL_PHASE_GRID = 500
_MCMC_NWALKERS = 32
_MCMC_NSTEPS = 1500
_MCMC_BURN = 500


def fit_transit_model(
    points: list[LightCurvePoint],
    period: float,
    t0: float,
    target_id: str = "",
    fit_limb_darkening: bool = False,
) -> TransitFitResponse:
    if len(points) < 10:
        raise ValueError("Not enough data points for transit fitting (need >= 10).")

    hjd = np.array([p.hjd for p in points], dtype=np.float64)
    flux = np.array([p.magnitude for p in points], dtype=np.float64)
    error = np.array([p.mag_error for p in points], dtype=np.float64)
    error = np.where(error > 0, error, np.nanmedian(error[error > 0]))

    # Phase fold centered on transit (phase 0 = mid-transit)
    phase = ((hjd - t0) / period % 1 + 0.5) % 1 - 0.5

    # Auto-detect transit dip center and shift phase so dip is at 0
    phase_shift = _find_dip_phase(phase, flux, period)
    if abs(phase_shift) > 0.01:
        phase = phase - phase_shift
        phase = (phase + 0.5) % 1 - 0.5
        # Update effective t0 for reporting
        t0 = t0 + phase_shift * period

    sort_idx = np.argsort(phase)
    phase = phase[sort_idx]
    flux = flux[sort_idx]
    error = error[sort_idx]

    # Initial parameter estimates
    transit_mask = np.abs(phase) < 0.1
    min_flux = np.nanmin(flux[transit_mask]) if transit_mask.any() else np.nanmin(flux)
    rp_rs_init = float(np.clip(np.sqrt(np.abs(1.0 - min_flux)), 0.02, 0.3))

    # Estimate a/R* from transit duration using Kepler's third law approximation
    # For a solar-type star: a/R* ≈ (P/pi)^(2/3) * (G*M_sun/R_sun^3)^(1/3)
    # Simplified: a/R* ≈ 4.2 * P_days^(2/3) for a solar-density star
    a_rs_init = float(np.clip(4.2 * period ** (2.0 / 3.0), 3.0, 30.0))

    # Refine from transit duration if detectable
    a_rs_from_dur = _estimate_a_rs_from_duration(phase, flux, period)
    if a_rs_from_dur is not None:
        a_rs_init = a_rs_from_dur

    inc_init = 88.0
    u1_init = 0.3
    u2_init = 0.2

    initial_params = TransitFitParameters(
        rp_rs=round(rp_rs_init, 6),
        a_rs=round(a_rs_init, 4),
        inclination=round(inc_init, 4),
        u1=round(u1_init, 4),
        u2=round(u2_init, 4),
    )

    # Build initial model curve
    phase_grid = np.linspace(-0.5, 0.5, _MODEL_PHASE_GRID)
    initial_model = _evaluate_model(
        phase_grid, period, rp_rs_init, a_rs_init, inc_init, u1_init, u2_init,
    )
    initial_curve = TransitModelCurve(
        phase=[round(float(p), 6) for p in phase_grid],
        flux=[round(float(f), 6) for f in initial_model],
    )

    # --- Fit using least_squares first for a good starting point ---
    if fit_limb_darkening:
        x0 = [rp_rs_init, a_rs_init, inc_init, u1_init, u2_init]
        bounds_lower = [0.001, 2.0, 70.0, 0.0, -0.5]
        bounds_upper = [0.5, 50.0, 90.0, 1.0, 1.0]
    else:
        x0 = [rp_rs_init, a_rs_init, inc_init]
        bounds_lower = [0.001, 2.0, 70.0]
        bounds_upper = [0.5, 50.0, 90.0]

    def residual_fn(params):
        if fit_limb_darkening:
            rp, a, inc, ld1, ld2 = params
        else:
            rp, a, inc = params
            ld1, ld2 = u1_init, u2_init
        model = _evaluate_model(phase, period, rp, a, inc, ld1, ld2)
        return (flux - model) / error

    try:
        ls_result = least_squares(
            residual_fn, x0, bounds=(bounds_lower, bounds_upper),
            method="trf", max_nfev=200,
        )
        best_ls = ls_result.x
    except Exception:
        best_ls = np.array(x0)

    # --- MCMC fitting with emcee ---
    if _HAS_EMCEE:
        fitted, uncertainties = _run_mcmc(
            phase, flux, error, period, best_ls,
            fit_limb_darkening, u1_init, u2_init,
        )
    else:
        fitted = best_ls
        uncertainties = np.zeros_like(fitted)

    if fit_limb_darkening:
        rp_fit, a_fit, inc_fit, u1_fit, u2_fit = fitted
        rp_err, a_err, inc_err, u1_err, u2_err = uncertainties
    else:
        rp_fit, a_fit, inc_fit = fitted[:3]
        rp_err, a_err, inc_err = uncertainties[:3]
        u1_fit, u2_fit = u1_init, u2_init
        u1_err, u2_err = 0.0, 0.0

    # Best-fit model curve
    best_model = _evaluate_model(
        phase_grid, period, rp_fit, a_fit, inc_fit, u1_fit, u2_fit,
    )
    model_curve = TransitModelCurve(
        phase=[round(float(p), 6) for p in phase_grid],
        flux=[round(float(f), 6) for f in best_model],
    )

    # Residuals at data points
    model_at_data = _evaluate_model(
        phase, period, rp_fit, a_fit, inc_fit, u1_fit, u2_fit,
    )
    residuals = flux - model_at_data

    # Chi-squared
    chi2 = float(np.sum((residuals / error) ** 2))
    n_params = 5 if fit_limb_darkening else 3
    dof = max(len(flux) - n_params, 1)
    reduced_chi2 = chi2 / dof

    fitted_params = TransitFitParameters(
        rp_rs=round(float(rp_fit), 6),
        rp_rs_err=round(float(rp_err), 6),
        a_rs=round(float(a_fit), 4),
        a_rs_err=round(float(a_err), 4),
        inclination=round(float(inc_fit), 4),
        inclination_err=round(float(inc_err), 4),
        u1=round(float(u1_fit), 4),
        u1_err=round(float(u1_err), 4),
        u2=round(float(u2_fit), 4),
        u2_err=round(float(u2_err), 4),
        chi_squared=round(chi2, 4),
        reduced_chi_squared=round(reduced_chi2, 4),
        degrees_of_freedom=dof,
    )

    return TransitFitResponse(
        target_id=target_id,
        period=round(period, 8),
        t0=round(t0, 6),
        fitted_params=fitted_params,
        initial_params=initial_params,
        model_curve=model_curve,
        initial_curve=initial_curve,
        data_phase=[round(float(p), 6) for p in phase],
        data_flux=[round(float(f), 6) for f in flux],
        data_error=[round(float(e), 6) for e in error],
        residuals=[round(float(r), 6) for r in residuals],
    )


def _run_mcmc(
    phase: np.ndarray,
    flux: np.ndarray,
    error: np.ndarray,
    period: float,
    initial: np.ndarray,
    fit_limb_darkening: bool,
    u1_fixed: float,
    u2_fixed: float,
) -> tuple[np.ndarray, np.ndarray]:
    ndim = len(initial)

    if fit_limb_darkening:
        bounds_lower = np.array([0.001, 2.0, 70.0, 0.0, -0.5])
        bounds_upper = np.array([0.5, 50.0, 90.0, 1.0, 1.0])
    else:
        bounds_lower = np.array([0.001, 2.0, 70.0])
        bounds_upper = np.array([0.5, 50.0, 90.0])

    def log_prior(params):
        if np.any(params < bounds_lower) or np.any(params > bounds_upper):
            return -np.inf
        return 0.0

    def log_likelihood(params):
        if fit_limb_darkening:
            rp, a, inc, ld1, ld2 = params
        else:
            rp, a, inc = params
            ld1, ld2 = u1_fixed, u2_fixed
        model = _evaluate_model(phase, period, rp, a, inc, ld1, ld2)
        return -0.5 * np.sum(((flux - model) / error) ** 2)

    def log_probability(params):
        lp = log_prior(params)
        if not np.isfinite(lp):
            return -np.inf
        ll = log_likelihood(params)
        if not np.isfinite(ll):
            return -np.inf
        return lp + ll

    # Initialize walkers as small ball around the least-squares solution
    scatter = np.abs(initial) * 0.01 + 1e-5
    pos = initial + scatter * np.random.randn(_MCMC_NWALKERS, ndim)
    # Clip to bounds
    pos = np.clip(pos, bounds_lower + 1e-6, bounds_upper - 1e-6)

    sampler = emcee.EnsembleSampler(_MCMC_NWALKERS, ndim, log_probability)
    sampler.run_mcmc(pos, _MCMC_NSTEPS, progress=False)

    flat_samples = sampler.get_chain(discard=_MCMC_BURN, flat=True)
    if flat_samples.shape[0] == 0:
        return initial, np.zeros(ndim)

    median = np.median(flat_samples, axis=0)
    sigma = np.std(flat_samples, axis=0)
    return median, sigma


def _evaluate_model(
    phase: np.ndarray,
    period: float,
    rp_rs: float,
    a_rs: float,
    inclination: float,
    u1: float,
    u2: float,
) -> np.ndarray:
    if _HAS_BATMAN:
        return _evaluate_batman(phase, period, rp_rs, a_rs, inclination, u1, u2)
    return _evaluate_simple(phase, period, rp_rs, a_rs, inclination)


def _evaluate_batman(
    phase: np.ndarray,
    period: float,
    rp_rs: float,
    a_rs: float,
    inclination: float,
    u1: float,
    u2: float,
) -> np.ndarray:
    params = batman.TransitParams()
    params.t0 = 0.0
    params.per = 1.0  # period in phase units = 1
    params.rp = float(np.clip(rp_rs, 0.001, 0.5))
    params.a = float(np.clip(a_rs, 1.5, 50.0))
    params.inc = float(np.clip(inclination, 60.0, 90.0))
    params.ecc = 0.0
    params.w = 90.0
    params.u = [float(u1), float(u2)]
    params.limb_dark = "quadratic"

    t = np.asarray(phase, dtype=np.float64)
    m = batman.TransitModel(params, t)
    return m.light_curve(params)


def _evaluate_simple(
    phase: np.ndarray,
    period: float,
    rp_rs: float,
    a_rs: float,
    inclination: float,
) -> np.ndarray:
    """Fallback: simplified box-like transit model when batman is not available."""
    inc_rad = np.radians(inclination)
    b = a_rs * np.cos(inc_rad)
    duration_phase = (1.0 / np.pi) * np.arcsin(
        np.sqrt((1 + rp_rs) ** 2 - b**2) / a_rs / np.sin(inc_rad)
    ) if a_rs * np.sin(inc_rad) > 0 else 0.05
    depth = rp_rs**2
    model = np.ones_like(phase)
    in_transit = np.abs(phase) < duration_phase
    model[in_transit] = 1.0 - depth
    return model


def _estimate_a_rs_from_duration(
    phase: np.ndarray,
    flux: np.ndarray,
    period: float,
) -> float | None:
    """Estimate a/R* from the transit duration in the phase-folded light curve."""
    n_bins = 100
    bin_edges = np.linspace(-0.5, 0.5, n_bins + 1)
    bin_centers = 0.5 * (bin_edges[:-1] + bin_edges[1:])
    bin_flux = np.full(n_bins, np.nan)

    for i in range(n_bins):
        mask = (phase >= bin_edges[i]) & (phase < bin_edges[i + 1])
        if mask.sum() >= 2:
            bin_flux[i] = np.nanmedian(flux[mask])

    finite = np.isfinite(bin_flux)
    if finite.sum() < 10:
        return None

    baseline = np.nanmedian(bin_flux[finite])
    dip = baseline - np.nanmin(bin_flux[finite])
    if dip < 0.0005:
        return None

    # Threshold at half-depth
    threshold = baseline - dip * 0.5
    in_transit = bin_flux < threshold
    if not in_transit.any():
        return None

    # Duration in phase units
    transit_bins = np.where(in_transit)[0]
    # Handle wrap-around: find contiguous region near phase 0
    near_zero = transit_bins[np.abs(bin_centers[transit_bins]) < 0.25]
    if len(near_zero) < 2:
        return None

    duration_phase = float(bin_centers[near_zero[-1]] - bin_centers[near_zero[0]])
    if duration_phase <= 0.005 or duration_phase > 0.2:
        return None

    # a/R* ≈ pi / (duration_phase * sin(i)) for i~90 deg
    # Simplified: a/R* ≈ 1 / (duration_phase * pi) * sqrt(1 - b^2)
    # For b~0: a/R* ≈ 1 / (duration_phase * pi)
    a_rs = 1.0 / (duration_phase * np.pi)
    return float(np.clip(a_rs, 3.0, 30.0))


def _find_dip_phase(
    phase: np.ndarray,
    flux: np.ndarray,
    period: float,
) -> float:
    """Find the phase offset of the transit dip using a binned light curve."""
    n_bins = 50
    bin_edges = np.linspace(-0.5, 0.5, n_bins + 1)
    bin_centers = 0.5 * (bin_edges[:-1] + bin_edges[1:])
    bin_flux = np.full(n_bins, np.nan)

    for i in range(n_bins):
        mask = (phase >= bin_edges[i]) & (phase < bin_edges[i + 1])
        if mask.sum() >= 3:
            bin_flux[i] = np.nanmedian(flux[mask])

    finite = np.isfinite(bin_flux)
    if finite.sum() < 5:
        return 0.0

    # Find the bin with minimum flux = transit center
    min_idx = np.nanargmin(bin_flux)
    dip_phase = float(bin_centers[min_idx])

    # Only shift if the dip is clearly below the baseline
    baseline = np.nanmedian(bin_flux[finite])
    dip_depth = baseline - bin_flux[min_idx]
    scatter = np.nanstd(bin_flux[finite])
    if dip_depth < 2 * scatter:
        return 0.0

    return dip_phase
