from __future__ import annotations

import base64
import io
import logging
import warnings
from dataclasses import dataclass
from functools import lru_cache
from typing import Any

import astropy.units as u
import httpx
import numpy as np
from astropy.coordinates import SkyCoord
from astropy.io import fits
from astropy.nddata import Cutout2D
from astropy.utils.exceptions import AstropyWarning
from astropy.wcs import FITSFixedWarning, WCS
from PIL import Image
from scipy import ndimage

from adapters.kmtnet_archive import archive
from schemas.microlensing import (
    MicrolensingLightCurveResponse,
    MicrolensingPixelCoordinate,
    MicrolensingPoint,
    MicrolensingPreviewFrameMetadata,
    MicrolensingPreviewResponse,
)
from services import kmtnet_data_service

_SITE_LABELS = {
    "ctio": "CTIO (칠레)",
    "saao": "SAAO (남아프리카)",
    "sso": "SSO (호주)",
}
_SITE_OBSERVATORY = {
    "ctio": "CTIO",
    "saao": "SAAO",
    "sso": "SSO",
}

_PREVIEW_IMAGE_SIZE_PX = 320
_DEFAULT_CUTOUT_SIZE_PX = 64
_MIN_CUTOUT_SIZE_PX = 48
_MAX_CUTOUT_SIZE_PX = 96
_LIGHTCURVE_SAMPLE_LIMIT_PER_SITE = 4
_REFERENCE_SAMPLE_COUNT = 3
_DOWNLOAD_TIMEOUT_SECONDS = 90.0
_REGISTRATION_MAX_SHIFT_PX = 5

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class _CutoutFrame:
    target_id: str
    site: str
    row: dict[str, Any]
    raw_data: np.ndarray
    bg_subtracted: np.ndarray
    target_x: float
    target_y: float


def get_lightcurve(target_id: str, site: str | None = None) -> MicrolensingLightCurveResponse:
    site_token = site.strip().lower() if isinstance(site, str) else "__all__"
    return _get_lightcurve_cached(target_id, site_token)


@lru_cache(maxsize=24)
def _get_lightcurve_cached(target_id: str, site_token: str) -> MicrolensingLightCurveResponse:
    target = archive.get_target(target_id)
    if not target:
        raise ValueError(f"Target not found: {target_id}")

    site_keys = [_normalize_site_key(site_token)] if site_token != "__all__" else list(_SITE_LABELS)
    baseline_mag = _target_baseline_magnitude(target)
    points: list[MicrolensingPoint] = []

    for site_key in site_keys:
        rows = _list_rows(target_id, site_key)
        if not rows:
            continue

        sampled_rows = _downsample_rows(rows, _LIGHTCURVE_SAMPLE_LIMIT_PER_SITE)
        reference_row = _resolve_reference_row(target_id, site_key, _DEFAULT_CUTOUT_SIZE_PX)
        try:
            reference_frame = _load_cutout_frame(target, reference_row, _DEFAULT_CUTOUT_SIZE_PX)
        except Exception as error:
            logger.warning(
                "Failed to load KMT reference frame for %s/%s: %s",
                target_id,
                site_key,
                error,
            )
            continue
        reference_flux = max(
            _measure_aperture_sum(
                reference_frame.raw_data,
                reference_frame.target_x,
                reference_frame.target_y,
            ),
            1.0,
        )

        for row in sampled_rows:
            try:
                frame = _load_cutout_frame(target, row, _DEFAULT_CUTOUT_SIZE_PX)
                aligned_frame = _register_frame_to_reference(frame, reference_frame)
            except Exception as error:
                logger.warning(
                    "Skipping KMT frame %s for %s/%s during light-curve extraction: %s",
                    row.get("id"),
                    target_id,
                    site_key,
                    error,
                )
                continue

            difference = aligned_frame.bg_subtracted - reference_frame.bg_subtracted
            difference_flux = _measure_net_flux(
                difference,
                reference_frame.target_x,
                reference_frame.target_y,
            )
            total_flux = max(reference_flux + difference_flux, 1.0)
            flux_error = _estimate_flux_error(
                aligned_frame.bg_subtracted,
                reference_frame.target_x,
                reference_frame.target_y,
            )
            mag_error = float(np.clip(1.0857 * flux_error / total_flux, 0.02, 0.35))
            magnitude = baseline_mag - 2.5 * np.log10(total_flux / reference_flux)
            points.append(
                MicrolensingPoint(
                    hjd=float(row["hjd"]),
                    site=site_key,
                    magnitude=round(float(magnitude), 4),
                    mag_error=round(float(mag_error), 4),
                )
            )

    points.sort(key=lambda point: point.hjd)
    if not points:
        raise ValueError(f"No KMTNet cutout data available for {target_id}.")

    return MicrolensingLightCurveResponse(
        target_id=target_id,
        points=points,
        x_label="HJD",
        y_label="Relative magnitude from actual KMTNet cutouts",
    )


def get_preview(
    target_id: str,
    site: str,
    frame_index: int | None = None,
    size_px: int = _DEFAULT_CUTOUT_SIZE_PX,
) -> MicrolensingPreviewResponse:
    resolved_frame_index = 0 if frame_index is None else int(frame_index)
    return _get_preview_cached(target_id, site, resolved_frame_index, int(size_px))


@lru_cache(maxsize=256)
def _get_preview_cached(
    target_id: str,
    site: str,
    frame_index: int,
    size_px: int,
) -> MicrolensingPreviewResponse:
    target = archive.get_target(target_id)
    if not target:
        raise ValueError(f"Target not found: {target_id}")

    site_key = _normalize_site_key(site)
    rows = _list_rows(target_id, site_key)
    if not rows:
        raise ValueError(f"No KMTNet observations available for {target_id} at {site_key}.")

    resolved_size_px = _normalize_cutout_size(size_px)
    resolved_frame_index = max(0, min(len(rows) - 1, int(frame_index)))
    selected_row = rows[resolved_frame_index]
    reference_row = _resolve_reference_row(target_id, site_key, resolved_size_px)
    reference_frame_index = next(
        (index for index, row in enumerate(rows) if row["id"] == reference_row["id"]),
        0,
    )

    selected_frame = _load_cutout_frame(target, selected_row, resolved_size_px)
    reference_frame = _load_cutout_frame(target, reference_row, resolved_size_px)
    aligned_frame = _register_frame_to_reference(selected_frame, reference_frame)
    difference_frame = aligned_frame.bg_subtracted - reference_frame.bg_subtracted

    reference_flux = max(
        _measure_aperture_sum(
            reference_frame.raw_data,
            reference_frame.target_x,
            reference_frame.target_y,
        ),
        1.0,
    )
    difference_flux = _measure_net_flux(
        difference_frame,
        reference_frame.target_x,
        reference_frame.target_y,
    )
    total_flux = max(reference_flux + difference_flux, 1.0)
    magnitude = _target_baseline_magnitude(target) - 2.5 * np.log10(total_flux / reference_flux)
    mag_error = float(
        np.clip(
            1.0857
            * _estimate_flux_error(
                aligned_frame.bg_subtracted,
                reference_frame.target_x,
                reference_frame.target_y,
            )
            / total_flux,
            0.02,
            0.35,
        )
    )

    return MicrolensingPreviewResponse(
        target_id=target_id,
        site=site_key,
        site_label=_SITE_LABELS[site_key],
        frame_index=resolved_frame_index,
        frame_count=len(rows),
        sample_frame_indices=_sample_frame_indices(len(rows)),
        cutout_size_px=resolved_size_px,
        cutout_width_px=int(selected_frame.raw_data.shape[1]),
        cutout_height_px=int(selected_frame.raw_data.shape[0]),
        preview_width_px=_PREVIEW_IMAGE_SIZE_PX,
        preview_height_px=_PREVIEW_IMAGE_SIZE_PX,
        target_position=MicrolensingPixelCoordinate(
            x=round(float(reference_frame.target_x), 2),
            y=round(float(reference_frame.target_y), 2),
        ),
        raw_target_position=MicrolensingPixelCoordinate(
            x=round(float(selected_frame.target_x), 2),
            y=round(float(selected_frame.target_y), 2),
        ),
        aligned_target_position=MicrolensingPixelCoordinate(
            x=round(float(reference_frame.target_x), 2),
            y=round(float(reference_frame.target_y), 2),
        ),
        reference_target_position=MicrolensingPixelCoordinate(
            x=round(float(reference_frame.target_x), 2),
            y=round(float(reference_frame.target_y), 2),
        ),
        reference_frame_index=reference_frame_index,
        reference_observation_id=str(reference_row["id"]),
        reference_hjd=float(reference_row["hjd"]),
        registration_dx_px=round(float(aligned_frame.shift_x), 2),
        registration_dy_px=round(float(aligned_frame.shift_y), 2),
        frame_metadata=MicrolensingPreviewFrameMetadata(
            frame_index=resolved_frame_index,
            observation_id=str(selected_row["id"]),
            hjd=float(selected_row["hjd"]),
            site=site_key,
            filter_band=str(selected_row.get("filter_band") or "I"),
            exposure_sec=float(selected_row.get("exposure_sec") or 0.0),
            airmass=float(selected_row.get("airmass") or 0.0),
            magnitude=round(float(magnitude), 4),
            mag_error=round(float(mag_error), 4),
            baseline_magnitude=round(float(_target_baseline_magnitude(target)), 4),
            magnification=round(float(total_flux / reference_flux), 3),
        ),
        raw_image_data_url=_encode_intensity_image(selected_frame.raw_data),
        aligned_image_data_url=_encode_intensity_image(aligned_frame.raw_data),
        reference_image_data_url=_encode_intensity_image(reference_frame.raw_data),
        difference_image_data_url=_encode_difference_image(difference_frame),
    )


def _normalize_site_key(site: str | None) -> str:
    site_key = str(site or "").strip().lower()
    if site_key not in _SITE_LABELS:
        raise ValueError(f"Unknown site: {site}")
    return site_key


def _normalize_cutout_size(size_px: int) -> int:
    return int(min(max(int(size_px), _MIN_CUTOUT_SIZE_PX), _MAX_CUTOUT_SIZE_PX))


def _target_baseline_magnitude(target: dict[str, Any]) -> float:
    model = target.get("model") or {}
    baseline = model.get("mag_base")
    if isinstance(baseline, (int, float)):
        return float(baseline)
    return 18.0


def _site_key_for_row(row: dict[str, Any]) -> str | None:
    label = str(row.get("display_label") or "").strip().upper()
    for site_key, observatory in _SITE_OBSERVATORY.items():
        if label == observatory:
            return site_key
    return None


@lru_cache(maxsize=32)
def _list_rows(target_id: str, site_key: str) -> list[dict[str, Any]]:
    rows = kmtnet_data_service.list_target_observations(target_id)
    filtered = [
        dict(row)
        for row in rows
        if row.get("cutout_url") and _site_key_for_row(row) == site_key
    ]
    filtered.sort(key=lambda row: float(row.get("hjd") or 0.0))
    return filtered


def _downsample_rows(rows: list[dict[str, Any]], limit: int) -> list[dict[str, Any]]:
    if len(rows) <= limit:
        return rows
    indices = sorted({int(round(value)) for value in np.linspace(0, len(rows) - 1, limit)})
    return [rows[index] for index in indices]


@lru_cache(maxsize=64)
def _resolve_reference_observation_id(target_id: str, site_key: str, size_px: int) -> str:
    target = archive.get_target(target_id)
    if not target:
        raise ValueError(f"Target not found: {target_id}")
    rows = _list_rows(target_id, site_key)
    if not rows:
        raise ValueError(f"No KMTNet observations available for {target_id} at {site_key}.")

    candidate_rows = _downsample_rows(rows, min(len(rows), _REFERENCE_SAMPLE_COUNT))
    best_row_id = str(candidate_rows[0]["id"])
    best_flux = None
    for row in candidate_rows:
        frame = _load_cutout_frame(target, row, size_px)
        flux = _measure_net_flux(frame.bg_subtracted, frame.target_x, frame.target_y)
        if not np.isfinite(flux):
            continue
        if best_flux is None or flux < best_flux:
            best_flux = flux
            best_row_id = str(row["id"])
    return best_row_id


def _resolve_reference_row(target_id: str, site_key: str, size_px: int) -> dict[str, Any]:
    observation_id = _resolve_reference_observation_id(target_id, site_key, size_px)
    rows = _list_rows(target_id, site_key)
    return next((row for row in rows if str(row["id"]) == observation_id), rows[0])


@dataclass(frozen=True)
class _RegisteredFrame:
    raw_data: np.ndarray
    bg_subtracted: np.ndarray
    shift_x: float
    shift_y: float


def _register_frame_to_reference(
    frame: _CutoutFrame,
    reference_frame: _CutoutFrame,
) -> _RegisteredFrame:
    shift_x, shift_y = _estimate_registration_shift(
        reference_frame.bg_subtracted,
        frame.bg_subtracted,
    )
    aligned_raw = _shift_image(frame.raw_data, shift_x=shift_x, shift_y=shift_y)
    aligned_bg = _shift_image(frame.bg_subtracted, shift_x=shift_x, shift_y=shift_y)
    return _RegisteredFrame(
        raw_data=aligned_raw,
        bg_subtracted=aligned_bg,
        shift_x=shift_x,
        shift_y=shift_y,
    )


def _load_cutout_frame(target: dict[str, Any], row: dict[str, Any], size_px: int) -> _CutoutFrame:
    site_key = _site_key_for_row(row)
    if site_key is None:
        raise ValueError(f"Unable to determine site for observation {row.get('id')}")
    return _load_cutout_frame_cached(str(target["id"]), site_key, str(row["id"]), int(size_px))


@lru_cache(maxsize=96)
def _load_cutout_frame_cached(
    target_id: str,
    site_key: str,
    observation_id: str,
    size_px: int,
) -> _CutoutFrame:
    target = archive.get_target(target_id)
    if not target:
        raise ValueError(f"Target not found: {target_id}")
    rows = _list_rows(target_id, site_key)
    row = next((candidate for candidate in rows if str(candidate["id"]) == observation_id), None)
    if row is None:
        raise ValueError(f"Observation not found: {observation_id}")

    fits_bytes = _download_fits_bytes(str(row["cutout_url"]))
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", AstropyWarning)
        warnings.simplefilter("ignore", FITSFixedWarning)
        with fits.open(io.BytesIO(fits_bytes), memmap=False) as hdul:
            hdu = hdul[1] if len(hdul) > 1 else hdul[0]
            image = np.asarray(hdu.data, dtype=np.float32)
            wcs = WCS(hdu.header)
            coord = SkyCoord(ra=float(target["ra"]) * u.deg, dec=float(target["dec"]) * u.deg)
            pixel_x, pixel_y = wcs.world_to_pixel(coord)
            cutout = Cutout2D(
                image,
                position=(float(np.asarray(pixel_x)), float(np.asarray(pixel_y))),
                size=(size_px, size_px),
                wcs=wcs,
                mode="partial",
                fill_value=np.nan,
                copy=True,
            )

    position_cutout = getattr(cutout, "position_cutout", (size_px / 2, size_px / 2))
    target_x = float(position_cutout[0])
    target_y = float(position_cutout[1])
    raw_data = np.asarray(cutout.data, dtype=np.float32)
    bg_subtracted = raw_data - _estimate_background(raw_data)
    return _CutoutFrame(
        target_id=target_id,
        site=site_key,
        row=row,
        raw_data=raw_data,
        bg_subtracted=bg_subtracted,
        target_x=target_x,
        target_y=target_y,
    )


def _estimate_background(image: np.ndarray) -> float:
    border = max(3, min(6, image.shape[0] // 8))
    border_pixels = np.concatenate(
        [
            image[:border, :].ravel(),
            image[-border:, :].ravel(),
            image[:, :border].ravel(),
            image[:, -border:].ravel(),
        ]
    )
    finite = border_pixels[np.isfinite(border_pixels)]
    if finite.size == 0:
        return 0.0
    return float(np.nanmedian(finite))


def _estimate_registration_shift(
    reference_image: np.ndarray,
    moving_image: np.ndarray,
    max_shift_px: int = _REGISTRATION_MAX_SHIFT_PX,
) -> tuple[float, float]:
    ref = np.asarray(reference_image, dtype=np.float32)
    mov = np.asarray(moving_image, dtype=np.float32)

    ref_finite = ref[np.isfinite(ref)]
    mov_finite = mov[np.isfinite(mov)]
    if ref_finite.size == 0 or mov_finite.size == 0:
        return 0.0, 0.0

    ref_centered = np.nan_to_num(ref - float(np.nanmedian(ref_finite)), nan=0.0)
    mov_centered = np.nan_to_num(mov - float(np.nanmedian(mov_finite)), nan=0.0)
    feature_level = float(np.nanpercentile(np.abs(ref_centered), 75.0))
    if not np.isfinite(feature_level) or feature_level <= 0.0:
        feature_mask = np.ones(ref_centered.shape, dtype=bool)
    else:
        feature_mask = np.abs(ref_centered) >= feature_level

    best_shift = (0.0, 0.0)
    best_score = float("inf")

    for shift_y in range(-max_shift_px, max_shift_px + 1):
        for shift_x in range(-max_shift_px, max_shift_px + 1):
            shifted = _shift_image(mov_centered, shift_x=shift_x, shift_y=shift_y, cval=0.0)
            residual = ref_centered[feature_mask] - shifted[feature_mask]
            score = float(np.mean(residual**2))
            if score < best_score:
                best_score = score
                best_shift = (float(shift_x), float(shift_y))

    return best_shift


def _shift_image(
    image: np.ndarray,
    *,
    shift_x: float,
    shift_y: float,
    cval: float = np.nan,
) -> np.ndarray:
    shifted = ndimage.shift(
        np.asarray(image, dtype=np.float32),
        shift=(float(shift_y), float(shift_x)),
        order=1,
        mode="constant",
        cval=float(cval),
        prefilter=False,
    )
    return np.asarray(shifted, dtype=np.float32)


def _measure_net_flux(
    image: np.ndarray,
    center_x: float,
    center_y: float,
    aperture_radius: float = 2.5,
    inner_annulus: float = 4.0,
    outer_annulus: float = 6.0,
) -> float:
    height, width = image.shape
    aperture_mask = _circular_mask(width, height, center_x, center_y, aperture_radius)
    annulus_mask = _annulus_mask(width, height, center_x, center_y, inner_annulus, outer_annulus)
    raw_flux = float(np.nansum(image[aperture_mask]))
    annulus_values = image[annulus_mask]
    sky_per_pixel = float(np.nanmedian(annulus_values)) if np.isfinite(annulus_values).any() else 0.0
    sky_flux = sky_per_pixel * max(int(aperture_mask.sum()), 1)
    net_flux = raw_flux - sky_flux
    if not np.isfinite(net_flux):
        return 0.0
    return float(net_flux)


def _measure_aperture_sum(
    image: np.ndarray,
    center_x: float,
    center_y: float,
    aperture_radius: float = 2.5,
) -> float:
    height, width = image.shape
    aperture_mask = _circular_mask(width, height, center_x, center_y, aperture_radius)
    aperture_values = image[aperture_mask]
    if aperture_values.size == 0 or not np.isfinite(aperture_values).any():
        return 0.0
    return float(np.nansum(aperture_values))


def _estimate_flux_error(
    image: np.ndarray,
    center_x: float,
    center_y: float,
    aperture_radius: float = 2.5,
    inner_annulus: float = 4.0,
    outer_annulus: float = 6.0,
) -> float:
    height, width = image.shape
    aperture_mask = _circular_mask(width, height, center_x, center_y, aperture_radius)
    annulus_mask = _annulus_mask(width, height, center_x, center_y, inner_annulus, outer_annulus)
    annulus_values = image[annulus_mask]
    finite = annulus_values[np.isfinite(annulus_values)]
    if finite.size == 0:
        return 1.0
    sky_sigma = float(np.nanstd(finite))
    return max(sky_sigma * np.sqrt(max(int(aperture_mask.sum()), 1)), 1.0)


def _circular_mask(
    width: int,
    height: int,
    center_x: float,
    center_y: float,
    radius: float,
) -> np.ndarray:
    y_indices, x_indices = np.indices((height, width), dtype=float)
    return ((x_indices + 0.5 - center_x) ** 2 + (y_indices + 0.5 - center_y) ** 2) <= radius**2


def _annulus_mask(
    width: int,
    height: int,
    center_x: float,
    center_y: float,
    inner_radius: float,
    outer_radius: float,
) -> np.ndarray:
    y_indices, x_indices = np.indices((height, width), dtype=float)
    distance2 = (x_indices + 0.5 - center_x) ** 2 + (y_indices + 0.5 - center_y) ** 2
    return (distance2 >= inner_radius**2) & (distance2 <= outer_radius**2)


def _sample_frame_indices(frame_count: int) -> list[int]:
    if frame_count <= 0:
        return []
    anchors = [0, frame_count // 4, frame_count // 2, (3 * frame_count) // 4, frame_count - 1]
    return list(dict.fromkeys(max(0, min(frame_count - 1, value)) for value in anchors))


def _download_fits_bytes(url: str) -> bytes:
    response = httpx.get(url, timeout=_DOWNLOAD_TIMEOUT_SECONDS, follow_redirects=True)
    response.raise_for_status()
    return response.content


def _encode_intensity_image(image: np.ndarray) -> str:
    finite_pixels = image[np.isfinite(image)]
    if finite_pixels.size == 0:
        finite_pixels = np.array([0.0, 1.0], dtype=np.float32)
    low, high = np.percentile(finite_pixels, [5.0, 99.7])
    if high <= low:
        high = low + 1.0
    normalized = np.clip((image - low) / (high - low), 0.0, 1.0)
    normalized = np.nan_to_num(normalized, nan=0.0, posinf=1.0, neginf=0.0)
    stretched = np.arcsinh(normalized * 8.0) / np.arcsinh(8.0)
    rgb = np.stack(
        [
            stretched * 242.0,
            np.power(stretched, 0.9) * 214.0 + 16.0,
            np.power(stretched, 0.72) * 196.0 + 22.0,
        ],
        axis=-1,
    )
    rgb = np.nan_to_num(rgb, nan=0.0, posinf=255.0, neginf=0.0).astype(np.uint8)
    return _encode_rgb_image(rgb)


def _encode_difference_image(image: np.ndarray) -> str:
    finite_pixels = np.abs(image[np.isfinite(image)])
    scale = float(np.percentile(finite_pixels, 99.5)) if finite_pixels.size > 0 else 1.0
    if scale <= 0:
        scale = 1.0
    normalized = np.clip(image / scale, -1.0, 1.0)
    normalized = np.nan_to_num(normalized, nan=0.0, posinf=1.0, neginf=-1.0)
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
    )
    rgb = np.nan_to_num(rgb, nan=0.0, posinf=255.0, neginf=0.0).astype(np.uint8)
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
