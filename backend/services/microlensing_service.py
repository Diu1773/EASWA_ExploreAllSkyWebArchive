"""Paczyński microlensing model fitting service."""

from __future__ import annotations

import base64
import hashlib
import io
import random

import numpy as np
from scipy.optimize import curve_fit
from PIL import Image

from adapters.kmtnet_archive import archive
from schemas.microlensing import (
    MicrolensingPoint,
    MicrolensingLightCurveResponse,
    MicrolensingFitRequest,
    MicrolensingFitResponse,
    MicrolensingModelPoint,
    MicrolensingPixelCoordinate,
    MicrolensingPreviewBundleResponse,
    MicrolensingPreviewFrameMetadata,
    MicrolensingPreviewResponse,
)
from services import kmtnet_actual_service

_SITE_LABELS = {
    "ctio": "CTIO (칠레)",
    "saao": "SAAO (남아프리카)",
    "sso": "SSO (호주)",
}
_PREVIEW_IMAGE_SIZE_PX = 320
_DEFAULT_PREVIEW_CUTOUT_SIZE_PX = 64
_MIN_PREVIEW_CUTOUT_SIZE_PX = 48
_MAX_PREVIEW_CUTOUT_SIZE_PX = 96


def _stable_seed(*parts: object) -> int:
    digest = hashlib.sha256(":".join(str(part) for part in parts).encode("utf-8")).digest()
    return int.from_bytes(digest[:8], "big", signed=False)


def _amplification(u: float) -> float:
    safe_u = max(abs(u), 1e-6)
    u2 = safe_u ** 2
    return (u2 + 2.0) / (safe_u * np.sqrt(u2 + 4.0))


def _single_lens_model_mag(hjd: float, model: dict) -> float:
    tau = (hjd - model["t0"]) / max(model["tE"], 1e-4)
    u = np.sqrt(model["u0"] ** 2 + tau ** 2)
    return float(model["mag_base"] - 2.5 * np.log10(_amplification(float(u))))


def _planetary_model_mag(hjd: float, model: dict) -> float:
    magnitude = _single_lens_model_mag(hjd, model)
    dt = hjd - model["planet_t0"]
    half_duration = model["planet_dur"] / 2.0
    if abs(dt) < half_duration:
        magnitude -= model["planet_depth"] * (1.0 - (dt / half_duration) ** 2)
    return float(magnitude)


def _target_model_mag(event: dict, hjd: float) -> float:
    model = event["model"]
    return _planetary_model_mag(hjd, model) if model["type"] == "planetary" else _single_lens_model_mag(hjd, model)


def _target_flux_ratio(event: dict, hjd: float) -> float:
    model_mag = _target_model_mag(event, hjd)
    return float(10 ** (-0.4 * (model_mag - event["model"]["mag_base"])))


def _synthetic_observation_magnitude(
    event: dict,
    observation_id: str,
    hjd: float,
) -> tuple[float, float]:
    mag = _target_model_mag(event, hjd)
    mag_err = 0.008 * 10 ** ((mag - 16.0) / 5.0)
    mag_err = min(max(mag_err, 0.004), 0.15)
    rng = random.Random(_stable_seed(event["id"], observation_id))
    mag += rng.gauss(0.0, mag_err)
    return round(float(mag), 4), round(float(mag_err), 4)


def _build_preview_star_field(
    target_id: str,
    site: str,
    size_px: int,
) -> tuple[np.ndarray, tuple[float, float], float]:
    rng = np.random.default_rng(_stable_seed("field", target_id, site, size_px))
    yy, xx = np.mgrid[0:size_px, 0:size_px].astype(np.float32)
    background = 48.0 + 5.0 * (xx / max(size_px - 1, 1)) + 4.0 * (yy / max(size_px - 1, 1))
    image = background + rng.normal(0.0, 1.4, size=(size_px, size_px)).astype(np.float32)
    target_x = size_px / 2 + 0.5
    target_y = size_px / 2 - 0.5

    for _ in range(72):
        x0 = float(rng.uniform(3.0, size_px - 3.0))
        y0 = float(rng.uniform(3.0, size_px - 3.0))
        sigma = float(rng.uniform(0.8, 1.7))
        flux = float(rng.lognormal(mean=4.5, sigma=0.55))
        profile = np.exp(-((xx - x0) ** 2 + (yy - y0) ** 2) / (2.0 * sigma ** 2))
        image += flux * profile

    blend_positions = [
        (target_x - 4.3, target_y - 2.1, 165.0, 1.25),
        (target_x + 3.8, target_y + 2.7, 148.0, 1.15),
        (target_x + 1.6, target_y - 4.1, 124.0, 0.95),
    ]
    for x0, y0, flux, sigma in blend_positions:
        profile = np.exp(-((xx - x0) ** 2 + (yy - y0) ** 2) / (2.0 * sigma ** 2))
        image += flux * profile

    source_sigma = 1.08
    return image.astype(np.float32), (target_x, target_y), source_sigma


def _render_preview_frame(
    base_field: np.ndarray,
    target_position: tuple[float, float],
    source_sigma: float,
    target_flux: float,
    noise_seed: int,
) -> np.ndarray:
    yy, xx = np.mgrid[0:base_field.shape[0], 0:base_field.shape[1]].astype(np.float32)
    x0, y0 = target_position
    profile = np.exp(-((xx - x0) ** 2 + (yy - y0) ** 2) / (2.0 * source_sigma ** 2))
    frame = np.array(base_field, dtype=np.float32, copy=True)
    frame += target_flux * profile
    rng = np.random.default_rng(noise_seed)
    frame += rng.normal(0.0, 1.1, size=frame.shape).astype(np.float32)
    frame = np.clip(frame, 0.0, None)
    return frame


def _encode_intensity_image(image: np.ndarray) -> str:
    finite_pixels = image[np.isfinite(image)]
    if finite_pixels.size == 0:
        finite_pixels = np.array([0.0, 1.0], dtype=np.float32)
    low, high = np.percentile(finite_pixels, [5.0, 99.7])
    if high <= low:
        high = low + 1.0
    normalized = np.clip((image - low) / (high - low), 0.0, 1.0)
    stretched = np.arcsinh(normalized * 8.0) / np.arcsinh(8.0)
    rgb = np.stack(
        [
            stretched * 242.0,
            np.power(stretched, 0.9) * 214.0 + 16.0,
            np.power(stretched, 0.72) * 196.0 + 22.0,
        ],
        axis=-1,
    ).astype(np.uint8)
    return _encode_rgb_image(rgb)


def _encode_difference_image(image: np.ndarray) -> str:
    finite_pixels = np.abs(image[np.isfinite(image)])
    scale = float(np.percentile(finite_pixels, 99.5)) if finite_pixels.size > 0 else 1.0
    if scale <= 0:
        scale = 1.0
    normalized = np.clip(image / scale, -1.0, 1.0)
    pos = np.clip(normalized, 0.0, 1.0)
    neg = np.clip(-normalized, 0.0, 1.0)
    mid = 1.0 - np.clip(np.abs(normalized), 0.0, 1.0)
    rgb = np.stack(
        [
            pos * 255.0 + mid * 18.0,
            pos * 146.0 + neg * 92.0 + mid * 12.0,
            neg * 255.0 + mid * 24.0,
        ],
        axis=-1,
    ).astype(np.uint8)
    return _encode_rgb_image(rgb)


def _encode_rgb_image(rgb: np.ndarray) -> str:
    preview = Image.fromarray(rgb, mode="RGB").resize(
        (_PREVIEW_IMAGE_SIZE_PX, _PREVIEW_IMAGE_SIZE_PX),
        resample=Image.Resampling.NEAREST,
    )
    buffer = io.BytesIO()
    preview.save(buffer, format="PNG")
    encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
    return f"data:image/png;base64,{encoded}"


def get_lightcurve(
    target_id: str,
    site: str | None = None,
    mode: str = "quick",
    include_sites: list[str] | None = None,
    reference_frame_index: int | None = None,
) -> MicrolensingLightCurveResponse:
    return kmtnet_actual_service.get_lightcurve(
        target_id,
        site=site,
        mode=mode,
        include_sites=include_sites,
        reference_frame_index=reference_frame_index,
    )


def get_preview(
    target_id: str,
    site: str,
    frame_index: int | None = None,
    size_px: int = _DEFAULT_PREVIEW_CUTOUT_SIZE_PX,
    reference_frame_index: int | None = None,
) -> MicrolensingPreviewResponse:
    return kmtnet_actual_service.get_preview(
        target_id,
        site=site,
        frame_index=frame_index,
        size_px=size_px,
        reference_frame_index=reference_frame_index,
    )


def get_preview_bundle(
    target_id: str,
    site: str,
    focus_frame_index: int | None = None,
    size_px: int = _DEFAULT_PREVIEW_CUTOUT_SIZE_PX,
    reference_frame_index: int | None = None,
) -> MicrolensingPreviewBundleResponse:
    return kmtnet_actual_service.get_preview_bundle(
        target_id,
        site=site,
        focus_frame_index=focus_frame_index,
        size_px=size_px,
        reference_frame_index=reference_frame_index,
    )


def _paczynski_mag(t: np.ndarray, t0: float, u0: float, tE: float, mag_base: float) -> np.ndarray:
    u0 = max(abs(u0), 1e-5)
    tE = max(abs(tE), 0.1)
    tau = (t - t0) / tE
    u = np.sqrt(u0 ** 2 + tau ** 2)
    A = (u ** 2 + 2.0) / (u * np.sqrt(u ** 2 + 4.0))
    return mag_base - 2.5 * np.log10(A)


def fit_paczynski(req: MicrolensingFitRequest) -> MicrolensingFitResponse:
    hjd = np.array([p.hjd for p in req.points])
    mag = np.array([p.magnitude for p in req.points])
    err = np.array([p.mag_error for p in req.points])

    if len(hjd) < 5:
        raise ValueError("최소 5개 이상의 데이터 포인트가 필요합니다.")

    # Initial guesses
    peak_idx = int(np.argmin(mag))
    t0_guess = req.t0_init if req.t0_init is not None else float(hjd[peak_idx])
    u0_guess = req.u0_init if req.u0_init is not None else 0.3
    tE_guess = req.tE_init if req.tE_init is not None else 20.0
    mag_base_guess = float(np.percentile(mag, 90))

    p0 = [t0_guess, u0_guess, tE_guess, mag_base_guess]
    bounds = (
        [float(hjd.min()), 1e-4, 0.5, mag_base_guess - 4.0],
        [float(hjd.max()), 2.0, 200.0, mag_base_guess + 1.0],
    )

    try:
        popt, pcov = curve_fit(
            _paczynski_mag, hjd, mag,
            p0=p0, sigma=err, bounds=bounds,
            maxfev=8000, absolute_sigma=True,
        )
        perr = np.sqrt(np.diag(pcov))
    except Exception as exc:
        raise ValueError(f"모델 적합 실패: {exc}") from exc

    t0_fit, u0_fit, tE_fit, mag_base_fit = popt
    t0_err, u0_err, tE_err, mag_base_err = perr

    # Model curve for overlay (300 points)
    t_model = np.linspace(float(hjd.min()), float(hjd.max()), 300)
    mag_model = _paczynski_mag(t_model, *popt)
    model_curve = [
        MicrolensingModelPoint(hjd=float(t), magnitude=float(m))
        for t, m in zip(t_model, mag_model)
    ]

    # Reduced chi-squared
    residuals = (mag - _paczynski_mag(hjd, *popt)) / err
    chi2_dof = float(np.sum(residuals ** 2) / max(len(hjd) - 4, 1))

    return MicrolensingFitResponse(
        t0=round(float(t0_fit), 4),
        u0=round(float(u0_fit), 5),
        tE=round(float(tE_fit), 3),
        mag_base=round(float(mag_base_fit), 4),
        t0_err=round(float(t0_err), 4),
        u0_err=round(float(u0_err), 5),
        tE_err=round(float(tE_err), 3),
        mag_base_err=round(float(mag_base_err), 4),
        chi2_dof=round(chi2_dof, 3),
        model_curve=model_curve,
    )
