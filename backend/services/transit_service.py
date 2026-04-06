from __future__ import annotations

import base64
import io
import json
import logging
import shutil
import tempfile
import time
import uuid
import zipfile
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from queue import Empty, Queue
from threading import Lock, Thread
from typing import Any, Callable
from urllib.parse import quote
from urllib.request import Request, urlopen

import numpy as np
import astropy.units as u
from astropy.coordinates import SkyCoord
from astropy.io import fits
from astropy.wcs import WCS
from PIL import Image

logger = logging.getLogger(__name__)

from adapters.transit_archive import archive as transit_archive
from config import (
    TRANSIT_CUTOUT_DISK_CACHE_DIR,
    TRANSIT_CUTOUT_DISK_CACHE_ENABLED,
    TRANSIT_CUTOUT_HOT_CACHE_MAX_ITEMS,
    TRANSIT_CUTOUT_MEMORY_CACHE_MAX_BYTES,
    TRANSIT_CUTOUT_MEMORY_CACHE_MAX_ITEMS,
    TRANSIT_CUTOUT_STAGE_DIR,
    TRANSIT_MAX_CUTOUT_SIZE_PX,
    TRANSIT_PREVIEW_JOB_MAX_ITEMS,
    TRANSIT_PREVIEW_JOB_TTL_SECONDS,
    TRANSIT_PREVIEW_WORKERS,
)
from schemas.lightcurve import LightCurvePoint, LightCurveResponse
from schemas.transit import (
    PixelCoordinate,
    TransitApertureConfig,
    TransitComparisonDiagnostic,
    TICStarInfo,
    TransitCutoutPreviewResponse,
    TransitFrameMetadata,
    TransitPhotometryRequest,
    TransitPhotometryResponse,
    TransitPreviewJobResponse,
)

_MAST_TIC_URL = "https://mast.stsci.edu/api/v0/invoke"

_TESSCUT_ASTROCUT_URL = "https://mast.stsci.edu/tesscut/api/v0.1/astrocut"
_DEFAULT_CUTOUT_SIZE_PX = 35
_FRAME_COUNT_LOOKUP_SIZE_PX = 1
_ALLOWED_CUTOUT_SIZES_PX = tuple(
    size for size in (30, 35, 40, 45, 50, 55, 60, 70, 80, 90, 99) if size <= TRANSIT_MAX_CUTOUT_SIZE_PX
) or (30,)
_PREVIEW_SIZE_PX = 456
_CUTOUT_CACHE_MAX_ITEMS = TRANSIT_CUTOUT_MEMORY_CACHE_MAX_ITEMS
_CUTOUT_CACHE_MAX_BYTES = TRANSIT_CUTOUT_MEMORY_CACHE_MAX_BYTES
_HOT_CUTOUT_CACHE_MAX_ITEMS = TRANSIT_CUTOUT_HOT_CACHE_MAX_ITEMS
_HOT_CUTOUT_CACHE_TTL_SECONDS = 20 * 60
_TRANSIT_STORAGE_ROOT = Path(__file__).resolve().parent.parent / ".cache" / "transit"
_TRANSIT_STAGE_DIR = (
    Path(TRANSIT_CUTOUT_STAGE_DIR)
    if TRANSIT_CUTOUT_STAGE_DIR
    else _TRANSIT_STORAGE_ROOT / "staging"
)
_DISK_CUTOUT_CACHE_DIR = (
    Path(TRANSIT_CUTOUT_DISK_CACHE_DIR)
    if TRANSIT_CUTOUT_DISK_CACHE_DIR
    else _TRANSIT_STORAGE_ROOT / "cutouts"
)
_TRANSIT_STAGE_FILE_TTL_SECONDS = 6 * 60 * 60
_TIC_EDGE_MARGIN_PX = 6.0
_TIC_MIN_LOCAL_COVERAGE = 0.85
_TIC_MIN_SIGNAL_SIGMA = 3.0
_TIC_DUPLICATE_TOLERANCE_PX = 0.75
_TIC_TARGET_EXCLUSION_PX = 1.0
_MAX_COMPARISON_SOURCES = 10
_MAX_RECOMMENDED_TIC_STARS = _MAX_COMPARISON_SOURCES
_MAX_COMPARISON_DIAGNOSTIC_POINTS = 1500
_PREVIEW_DATASET_TOKEN_TTL_SECONDS = 3 * 60
_PREVIEW_DATASET_TOKEN_MAX_ITEMS = 2


_cutout_cache_lock = Lock()
_cutout_cache: "OrderedDict[tuple[str, str, int, int], CutoutDataset]" = OrderedDict()
_hot_cutout_cache: "OrderedDict[tuple[str, str, int, int], tuple[float, CutoutDataset]]" = (
    OrderedDict()
)
_preview_dataset_tokens: "OrderedDict[str, tuple[float, CutoutDataset]]" = OrderedDict()
_preview_job_lock = Lock()
_preview_jobs: "OrderedDict[str, dict]" = OrderedDict()
_preview_executor = ThreadPoolExecutor(
    max_workers=TRANSIT_PREVIEW_WORKERS,
    thread_name_prefix="tess-preview",
)


class PreviewJobCancelled(Exception):
    pass


class PreviewCapacityError(Exception):
    pass


@dataclass(frozen=True)
class CutoutDataset:
    target_id: str
    observation_id: str
    sector: int
    camera: int | None
    ccd: int | None
    size_px: int
    cutout_url: str
    times: np.ndarray
    flux_cube: np.ndarray
    target_position: PixelCoordinate
    cadence_numbers: np.ndarray | None = None
    quality_flags: np.ndarray | None = None
    wcs: WCS | None = None


@dataclass(frozen=True)
class _ResolvedAperture:
    position: PixelCoordinate
    aperture_radius: float
    inner_annulus: float
    outer_annulus: float


def _normalize_cutout_size(size_px: int | None) -> int:
    if size_px is None:
        return _DEFAULT_CUTOUT_SIZE_PX

    requested = int(size_px)
    return min(_ALLOWED_CUTOUT_SIZES_PX, key=lambda allowed: abs(allowed - requested))


def _is_disk_cutout_cache_enabled() -> bool:
    return TRANSIT_CUTOUT_DISK_CACHE_ENABLED


def _ensure_transit_stage_dir() -> None:
    _TRANSIT_STAGE_DIR.mkdir(parents=True, exist_ok=True)


def _prune_transit_stage_dir() -> None:
    if not _TRANSIT_STAGE_DIR.exists():
        return
    now = time.time()
    for path in _TRANSIT_STAGE_DIR.iterdir():
        if not path.is_file():
            continue
        if path.suffix.lower() not in {".zip", ".fits"}:
            continue
        try:
            if now - path.stat().st_mtime > _TRANSIT_STAGE_FILE_TTL_SECONDS:
                path.unlink(missing_ok=True)
        except OSError:
            continue


def create_preview_job(
    target_id: str,
    observation_id: str,
    size_px: int = _DEFAULT_CUTOUT_SIZE_PX,
    frame_index: int | None = None,
) -> TransitPreviewJobResponse:
    _require_target(target_id)
    _require_observation(target_id, observation_id)
    normalized_size_px = _normalize_cutout_size(size_px)

    job_id = uuid.uuid4().hex
    job_state = {
        "job_id": job_id,
        "target_id": target_id,
        "observation_id": observation_id,
        "size_px": normalized_size_px,
        "frame_index": frame_index,
        "status": "queued",
        "progress": 0.0,
        "message": "Queued preview request.",
        "result": None,
        "error": None,
        "created_at": time.time(),
        "cancel_requested": False,
    }

    with _preview_job_lock:
        _prune_preview_jobs()
        _enforce_preview_job_capacity()
        _preview_jobs[job_id] = job_state

    _preview_executor.submit(_run_preview_job, job_id)
    return _serialize_preview_job(job_state)


def get_preview_job(job_id: str) -> TransitPreviewJobResponse:
    with _preview_job_lock:
        _prune_preview_jobs()
        state = _preview_jobs.get(job_id)
        if state is None:
            raise ValueError("Preview job not found.")
        return _serialize_preview_job(state)


def cancel_preview_job(job_id: str) -> TransitPreviewJobResponse:
    with _preview_job_lock:
        state = _preview_jobs.get(job_id)
        if state is None:
            raise ValueError("Preview job not found.")
        state["cancel_requested"] = True
        if state["status"] in {"queued", "running"}:
            state["status"] = "cancelled"
            state["message"] = "Preview request cancelled."
            state["progress"] = min(state["progress"], 0.99)
        return _serialize_preview_job(state)


def _query_tic_stars(
    ra: float,
    dec: float,
    radius_arcmin: float,
    target_tmag: float | None,
    wcs_obj,
    reference_image: np.ndarray,
    finite_coverage: np.ndarray,
    max_stars: int = 15,
    ) -> list[TICStarInfo]:
    """Query MAST TIC catalog for bright stars near the target."""
    try:
        rows = _query_tic_rows(ra, dec, radius_arcmin)
        if not rows:
            return []

        target_coord = SkyCoord(ra=ra * u.deg, dec=dec * u.deg)
        try:
            target_px, target_py = wcs_obj.all_world2pix([[float(ra), float(dec)]], 0)[0]
            target_pixel = PixelCoordinate(
                x=round(float(target_px) + 0.5, 2),
                y=round(float(target_py) + 0.5, 2),
            )
        except Exception:
            target_pixel = None
        stars: list[TICStarInfo] = []
        seen_tic_ids: set[str] = set()

        for row in rows:
            star_ra = row.get("ra")
            star_dec = row.get("dec")
            tmag = row.get("Tmag")
            tic_id = str(row.get("ID", ""))

            if star_ra is None or star_dec is None or tmag is None:
                continue
            if not isinstance(tmag, (int, float)) or tmag > 16:
                continue

            star_coord = SkyCoord(ra=float(star_ra) * u.deg, dec=float(star_dec) * u.deg)
            sep_arcmin = float(target_coord.separation(star_coord).arcmin)

            # Skip the target itself (within ~0.1')
            if sep_arcmin < 0.1:
                continue

            # Convert RA/Dec to pixel using WCS
            try:
                px, py = wcs_obj.all_world2pix([[float(star_ra), float(star_dec)]], 0)[0]
                pixel = PixelCoordinate(x=round(float(px) + 0.5, 2), y=round(float(py) + 0.5, 2))
            except Exception:
                continue

            if tic_id in seen_tic_ids:
                continue
            if target_pixel is not None and np.hypot(
                pixel.x - target_pixel.x,
                pixel.y - target_pixel.y,
            ) <= _TIC_TARGET_EXCLUSION_PX:
                continue
            if any(
                np.hypot(pixel.x - candidate.pixel.x, pixel.y - candidate.pixel.y)
                <= _TIC_DUPLICATE_TOLERANCE_PX
                for candidate in stars
            ):
                continue
            if not _is_viable_tic_star(pixel, reference_image, finite_coverage):
                continue

            # Check if variable — disposition or lumclass hints
            disposition = str(row.get("disposition", "") or "")
            is_variable = "VARIABLE" in disposition.upper()

            # Recommend if: bright, not variable, similar mag to target
            recommended = False
            if not is_variable and tmag < 14:
                if target_tmag is None or abs(tmag - target_tmag) < 3.0:
                    recommended = True

            stars.append(TICStarInfo(
                tic_id=tic_id,
                pixel=pixel,
                tmag=round(float(tmag), 2),
                distance_arcmin=round(sep_arcmin, 2),
                is_variable=is_variable,
                recommended=recommended,
            ))
            seen_tic_ids.add(tic_id)

        # Sort by brightness
        stars.sort(key=lambda s: s.tmag or 99)

        # Limit count and only keep the brightest N stars marked as recommended.
        stars = stars[:max_stars]
        rec_count = 0
        for star in stars:
            if star.recommended and rec_count < _MAX_RECOMMENDED_TIC_STARS:
                rec_count += 1
            elif star.recommended:
                star.recommended = False

        return stars

    except Exception as exc:
        logger.warning("TIC catalog query failed: %s", exc)
        return []


@lru_cache(maxsize=128)
def _query_tic_rows(
    ra: float,
    dec: float,
    radius_arcmin: float,
) -> list[dict[str, Any]]:
    request_payload = {
        "service": "Mast.Catalogs.Filtered.Tic.Position.Rows",
        "format": "json",
        "params": {
            "columns": "ID,ra,dec,Tmag,objType,lumclass,disposition",
            "filters": [],
            "ra": ra,
            "dec": dec,
            "radius": radius_arcmin / 60.0,
        },
    }

    body = f"request={quote(json.dumps(request_payload))}"
    request = Request(
        _MAST_TIC_URL,
        data=body.encode("utf-8"),
        headers={
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "text/plain",
        },
        method="POST",
    )

    with urlopen(request, timeout=15) as response:
        result = json.loads(response.read().decode("utf-8"))

    return result.get("data", [])


def _is_viable_tic_star(
    pixel: PixelCoordinate,
    reference_image: np.ndarray,
    finite_coverage: np.ndarray,
) -> bool:
    height, width = reference_image.shape
    if (
        pixel.x < _TIC_EDGE_MARGIN_PX
        or pixel.x > width - _TIC_EDGE_MARGIN_PX
        or pixel.y < _TIC_EDGE_MARGIN_PX
        or pixel.y > height - _TIC_EDGE_MARGIN_PX
    ):
        return False

    x = int(round(pixel.x - 0.5))
    y = int(round(pixel.y - 0.5))

    inner_y0 = max(0, y - 1)
    inner_y1 = min(height, y + 2)
    inner_x0 = max(0, x - 1)
    inner_x1 = min(width, x + 2)
    outer_y0 = max(0, y - 4)
    outer_y1 = min(height, y + 5)
    outer_x0 = max(0, x - 4)
    outer_x1 = min(width, x + 5)

    inner_patch = reference_image[inner_y0:inner_y1, inner_x0:inner_x1]
    outer_patch = reference_image[outer_y0:outer_y1, outer_x0:outer_x1]
    coverage_patch = finite_coverage[outer_y0:outer_y1, outer_x0:outer_x1]
    if inner_patch.size == 0 or outer_patch.size == 0 or coverage_patch.size == 0:
        return False

    local_coverage = float(np.nanmean(coverage_patch))
    if not np.isfinite(local_coverage) or local_coverage < _TIC_MIN_LOCAL_COVERAGE:
        return False

    inner_finite = inner_patch[np.isfinite(inner_patch)]
    outer_finite_mask = np.isfinite(outer_patch)
    if inner_finite.size == 0 or outer_finite_mask.sum() < 12:
        return False

    inner_peak = float(np.nanmax(inner_finite))
    outer_mask = np.ones_like(outer_patch, dtype=bool)
    outer_mask[
        inner_y0 - outer_y0 : inner_y1 - outer_y0,
        inner_x0 - outer_x0 : inner_x1 - outer_x0,
    ] = False
    background = outer_patch[outer_mask & outer_finite_mask]
    if background.size < 8:
        return False

    background_level = float(np.nanmedian(background))
    background_sigma = float(np.nanstd(background))
    if not np.isfinite(background_sigma) or background_sigma <= 0:
        background_sigma = max(abs(background_level) * 0.05, 1e-3)

    return inner_peak > background_level + (_TIC_MIN_SIGNAL_SIGMA * background_sigma)


def get_cutout_preview(
    target_id: str,
    observation_id: str,
    size_px: int = _DEFAULT_CUTOUT_SIZE_PX,
    frame_index: int | None = None,
    progress_callback: Callable[[float, str], None] | None = None,
) -> TransitCutoutPreviewResponse:
    target = _require_target(target_id)
    observation = _require_observation(target_id, observation_id)
    normalized_size_px = _normalize_cutout_size(size_px)
    dataset = _load_cutout_dataset(
        target_id,
        observation_id,
        target["ra"],
        target["dec"],
        observation["sector"],
        observation.get("camera"),
        observation.get("ccd"),
        observation["cutout_url"],
        normalized_size_px,
        progress_callback=progress_callback,
    )
    _notify_progress(progress_callback, 0.9, "Building cutout preview image.")
    preview_mode, resolved_frame_index, image_data_url = _build_preview_data_url(
        dataset.flux_cube,
        quality_flags=dataset.quality_flags,
        frame_index=frame_index,
    )
    height, width = dataset.flux_cube.shape[1:]
    # Query TIC catalog for comparison star recommendations
    tic_stars: list[TICStarInfo] = []
    if dataset.wcs is not None:
        fov_radius_arcmin = (normalized_size_px * 21.0) / 60.0 / 2.0
        target_tmag = target.get("tmag") or target.get("host_vmag")
        reference_index = _best_frame_index(dataset.flux_cube, dataset.quality_flags)
        reference_image = np.asarray(dataset.flux_cube[reference_index], dtype=np.float32)
        finite_coverage = np.mean(np.isfinite(dataset.flux_cube), axis=0)
        tic_stars = _query_tic_stars(
            ra=target["ra"],
            dec=target["dec"],
            radius_arcmin=fov_radius_arcmin,
            target_tmag=target_tmag,
            wcs_obj=dataset.wcs,
            reference_image=reference_image,
            finite_coverage=finite_coverage,
        )

    _notify_progress(progress_callback, 1.0, "Transit cutout preview ready.")
    dataset_token = _store_preview_dataset_token(dataset)

    return TransitCutoutPreviewResponse(
        target_id=target_id,
        observation_id=observation_id,
        sector=dataset.sector,
        camera=dataset.camera,
        ccd=dataset.ccd,
        preview_mode=preview_mode,
        frame_index=resolved_frame_index,
        sample_frame_indices=_sample_frame_indices(int(dataset.flux_cube.shape[0])),
        cutout_size_px=dataset.size_px,
        cutout_width_px=width,
        cutout_height_px=height,
        preview_width_px=_PREVIEW_SIZE_PX,
        preview_height_px=_PREVIEW_SIZE_PX,
        frame_count=int(dataset.flux_cube.shape[0]),
        time_start=round(float(np.nanmin(dataset.times)), 6),
        time_end=round(float(np.nanmax(dataset.times)), 6),
        frame_metadata=_build_frame_metadata(dataset, resolved_frame_index),
        target_position=dataset.target_position,
        image_data_url=image_data_url,
        dataset_token=dataset_token,
        tic_stars=tic_stars,
    )


def get_observation_frame_count(
    target_id: str,
    target_ra: float,
    target_dec: float,
    observation: dict[str, Any],
) -> int | None:
    try:
        dataset = _load_cutout_dataset(
            target_id,
            str(observation["id"]),
            float(target_ra),
            float(target_dec),
            int(observation["sector"]),
            int(observation["camera"]) if observation.get("camera") is not None else None,
            int(observation["ccd"]) if observation.get("ccd") is not None else None,
            str(observation.get("cutout_url") or ""),
            _FRAME_COUNT_LOOKUP_SIZE_PX,
        )
    except Exception as error:
        logger.warning(
            "Observation frame-count lookup failed for %s/%s: %s",
            target_id,
            observation.get("id"),
            error,
        )
        return None

    return int(dataset.flux_cube.shape[0])


def run_transit_photometry(
    req: TransitPhotometryRequest,
    progress_callback: Callable[[float, str], None] | None = None,
) -> TransitPhotometryResponse:
    def emit(progress: float, message: str) -> None:
        _notify_progress(progress_callback, float(np.clip(progress, 0.0, 1.0)), message)

    emit(0.02, "Resolving target and observation context.")
    target = _resolve_photometry_target(req)
    observation = _resolve_photometry_observation(req)
    normalized_size_px = _normalize_cutout_size(req.cutout_size_px)
    dataset = _restore_preview_dataset_token(
        req.preview_dataset_token,
        target_id=req.target_id,
        observation_id=req.observation_id,
        size_px=normalized_size_px,
    )
    if dataset is not None:
        emit(0.12, "Reusing cutout already loaded in step 1.")
    else:
        dataset = _load_cutout_dataset(
            req.target_id,
            req.observation_id,
            target["ra"],
            target["dec"],
            observation["sector"],
            observation.get("camera"),
            observation.get("ccd"),
            observation["cutout_url"],
            normalized_size_px,
            progress_callback=lambda progress, message: emit(
                0.05 + (0.5 * float(np.clip(progress, 0.0, 1.0))),
                message,
            ),
        )

    emit(0.58, "Preparing apertures and cadence filters.")
    target_aperture, comparison_apertures = _resolve_aperture_requests(req, dataset)

    # Filter bad cadences using TESS quality flags
    # Bit flags: momentum dump (bit 5=32), coarse point (bit 3=8),
    # Earth/Moon in FOV (bit 4=16), scattered light (bit 12=4096)
    quality_mask = np.ones(dataset.flux_cube.shape[0], dtype=bool)
    if dataset.quality_flags is not None:
        # Keep only cadences with no critical quality issues
        bad_bits = 8 | 16 | 32 | 4096  # coarse point, Earth/Moon, momentum dump, scattered light
        quality_mask = (dataset.quality_flags & bad_bits) == 0
        logger.info(
            "Quality flag filter: keeping %d / %d cadences",
            quality_mask.sum(), len(quality_mask),
        )

    flux_cube = dataset.flux_cube[quality_mask]
    times_filtered = dataset.times[quality_mask]

    emit(0.66, "Measuring target aperture flux.")
    target_flux = _extract_net_flux(
        flux_cube,
        target_aperture.position,
        target_aperture.aperture_radius,
        target_aperture.inner_annulus,
        target_aperture.outer_annulus,
    )
    target_mask = np.isfinite(target_flux) & (target_flux > 0)
    if not target_mask.any():
        raise ValueError("Target aperture did not produce any valid flux samples.")

    normalized_target = np.full(target_flux.shape, np.nan, dtype=np.float64)
    target_median_flux = float(np.nanmedian(target_flux[target_mask]))
    normalized_target[target_mask] = target_flux[target_mask] / target_median_flux

    diagnostic_payloads: list[dict[str, Any]] = []
    comparison_series: list[dict[str, Any]] = []
    total_comparisons = max(len(comparison_apertures), 1)
    for index, comparison_aperture in enumerate(comparison_apertures, start=1):
        emit(
            0.72 + 0.14 * ((index - 1) / total_comparisons),
            f"Measuring comparison star C{index} flux.",
        )
        comparison_flux = _extract_net_flux(
            flux_cube,
            comparison_aperture.position,
            comparison_aperture.aperture_radius,
            comparison_aperture.inner_annulus,
            comparison_aperture.outer_annulus,
        )
        comparison_mask = np.isfinite(comparison_flux) & (comparison_flux > 0)
        if not comparison_mask.any():
            continue

        comparison_median = float(np.nanmedian(comparison_flux[comparison_mask]))
        normalized_comparison = np.full(comparison_flux.shape, np.nan, dtype=np.float64)
        normalized_comparison[comparison_mask] = (
            comparison_flux[comparison_mask] / comparison_median
        )

        pair_mask = target_mask & comparison_mask
        if int(pair_mask.sum()) < 3:
            continue

        pair_flux = normalized_target[pair_mask] / normalized_comparison[pair_mask]
        pair_flux /= np.nanmedian(pair_flux)
        pair_rms = float(np.nanstd(pair_flux))
        pair_mad = _robust_mad(pair_flux)
        raw_weight = 1.0 / max(pair_rms, pair_mad * 1.4826, 0.0005) ** 2

        diagnostic_payloads.append(
            {
                "label": f"C{index}",
                "position": comparison_aperture.position,
                "aperture_radius": comparison_aperture.aperture_radius,
                "inner_annulus": comparison_aperture.inner_annulus,
                "outer_annulus": comparison_aperture.outer_annulus,
                "valid_frame_count": int(pair_mask.sum()),
                "median_flux": round(comparison_median, 2),
                "differential_rms": round(pair_rms, 6),
                "differential_mad": round(pair_mad, 6),
                "raw_weight": raw_weight,
                "light_curve": _build_light_curve_response(
                    req.target_id,
                    target.get("period_days"),
                    times_filtered[pair_mask],
                    pair_flux,
                    y_label="Normalized Flux",
                    max_points=_MAX_COMPARISON_DIAGNOSTIC_POINTS,
                ),
            }
        )
        comparison_series.append(
            {
                "normalized": normalized_comparison,
                "raw_flux": comparison_flux,
                "weight": raw_weight,
            }
        )

    emit(
        0.88,
        "Combining comparison-star ensemble."
        if comparison_series
        else "No valid comparison-star ensemble; using target-only normalization.",
    )
    if comparison_series:
        weighted_sum = np.zeros_like(normalized_target, dtype=np.float64)
        total_weight = np.zeros_like(normalized_target, dtype=np.float64)
        total_comparison_flux = np.zeros_like(normalized_target, dtype=np.float64)

        for series in comparison_series:
            normalized_comparison = series["normalized"]
            valid = np.isfinite(normalized_comparison) & (normalized_comparison > 0)
            if not valid.any():
                continue
            weight = float(series["weight"])
            weighted_sum[valid] += normalized_comparison[valid] * weight
            total_weight[valid] += weight
            total_comparison_flux[valid] += series["raw_flux"][valid]

        comparison_reference = np.full_like(normalized_target, np.nan, dtype=np.float64)
        available_comparison = total_weight > 0
        comparison_reference[available_comparison] = (
            weighted_sum[available_comparison] / total_weight[available_comparison]
        )
        differential_flux = np.full_like(normalized_target, np.nan, dtype=np.float64)
        valid_differential = (
            target_mask
            & available_comparison
            & np.isfinite(comparison_reference)
            & (comparison_reference > 0)
        )
        differential_flux[valid_differential] = (
            normalized_target[valid_differential] / comparison_reference[valid_differential]
        )
        comparison_median_flux = float(
            np.nanmedian(total_comparison_flux[available_comparison])
        ) if available_comparison.any() else 0.0
    else:
        differential_flux = normalized_target.copy()
        comparison_median_flux = 0.0

    finite_mask = np.isfinite(differential_flux) & (differential_flux > 0)
    if not finite_mask.any():
        raise ValueError("No valid cadences remained after comparison-star normalization.")

    times = times_filtered[finite_mask]
    normalized_flux = differential_flux[finite_mask]
    normalized_flux /= np.nanmedian(normalized_flux)

    emit(0.95, "Building normalized light curve.")
    scatter = float(np.nanstd(normalized_flux))
    light_curve = _build_light_curve_response(
        req.target_id,
        target.get("period_days"),
        times,
        normalized_flux,
        y_label="Normalized Flux",
    )

    normalized_total_weight = sum(item["raw_weight"] for item in diagnostic_payloads)
    comparison_diagnostics = [
        TransitComparisonDiagnostic(
            label=item["label"],
            position=item["position"],
            aperture_radius=item["aperture_radius"],
            inner_annulus=item["inner_annulus"],
            outer_annulus=item["outer_annulus"],
            valid_frame_count=item["valid_frame_count"],
            median_flux=item["median_flux"],
            differential_rms=item["differential_rms"],
            differential_mad=item["differential_mad"],
            ensemble_weight=round(
                item["raw_weight"] / normalized_total_weight if normalized_total_weight > 0 else 0.0,
                4,
            ),
            light_curve=item["light_curve"],
        )
        for item in diagnostic_payloads
    ]

    response = TransitPhotometryResponse(
        target_id=req.target_id,
        observation_id=req.observation_id,
        sector=dataset.sector,
        frame_count=len(times),
        comparison_count=len(comparison_diagnostics),
        target_position=target_aperture.position,
        comparison_positions=[diagnostic.position for diagnostic in comparison_diagnostics],
        target_median_flux=round(target_median_flux, 2),
        comparison_median_flux=round(comparison_median_flux, 2),
        comparison_diagnostics=comparison_diagnostics,
        light_curve=light_curve,
    )
    emit(1.0, "Transit photometry complete.")
    return response


def run_transit_photometry_streaming(
    req: TransitPhotometryRequest,
) -> Any:
    progress_queue: Queue[dict[str, Any]] = Queue()
    result_holder: dict[str, TransitPhotometryResponse] = {}
    error_holder: dict[str, str] = {}

    def worker() -> None:
        try:
            result_holder["result"] = run_transit_photometry(
                req,
                progress_callback=lambda progress, message: progress_queue.put(
                    {
                        "type": "progress",
                        "pct": float(np.clip(progress, 0.0, 1.0)),
                        "message": message,
                    }
                ),
            )
        except Exception as error:  # pragma: no cover - surfaced to client
            error_holder["message"] = str(error)

    thread = Thread(target=worker, daemon=True)
    thread.start()

    while thread.is_alive() or not progress_queue.empty():
        try:
            yield progress_queue.get(timeout=0.2)
        except Empty:
            continue

    if "message" in error_holder:
        yield {"type": "error", "message": error_holder["message"]}
        return

    result = result_holder.get("result")
    if result is None:
        yield {"type": "error", "message": "Transit photometry returned no result."}
        return

    yield {"type": "result", "data": result}


def _require_target(target_id: str) -> dict:
    target = transit_archive.get_target(target_id)
    if not target:
        raise ValueError("Transit target not found.")
    return target


def _require_observation(target_id: str, observation_id: str) -> dict:
    observation = transit_archive.get_observation(target_id, observation_id)
    if not observation:
        raise ValueError("Transit observation not found.")
    return observation


def _resolve_photometry_target(req: TransitPhotometryRequest) -> dict[str, Any]:
    if req.target_context is not None:
        return {
            "id": req.target_id,
            "ra": float(req.target_context.ra),
            "dec": float(req.target_context.dec),
            "period_days": req.target_context.period_days,
        }
    return _require_target(req.target_id)


def _resolve_photometry_observation(req: TransitPhotometryRequest) -> dict[str, Any]:
    if req.observation_context is not None:
        return {
            "id": req.observation_id,
            "sector": int(req.observation_context.sector),
            "camera": req.observation_context.camera,
            "ccd": req.observation_context.ccd,
            "cutout_url": "",
        }
    return _require_observation(req.target_id, req.observation_id)


def _resolve_aperture_requests(
    req: TransitPhotometryRequest,
    dataset: CutoutDataset,
) -> tuple[_ResolvedAperture, list[_ResolvedAperture]]:
    target_source = req.target_aperture or TransitApertureConfig(
        position=req.target_position,
        aperture_radius=req.aperture_radius,
        inner_annulus=req.inner_annulus,
        outer_annulus=req.outer_annulus,
    )
    comparison_sources = req.comparison_apertures[:_MAX_COMPARISON_SOURCES] or [
        TransitApertureConfig(
            position=position,
            aperture_radius=req.aperture_radius,
            inner_annulus=req.inner_annulus,
            outer_annulus=req.outer_annulus,
        )
        for position in req.comparison_positions[:_MAX_COMPARISON_SOURCES]
    ]

    return (
        _normalize_aperture_config(target_source, dataset),
        [_normalize_aperture_config(source, dataset) for source in comparison_sources],
    )


def _normalize_aperture_config(
    source: TransitApertureConfig,
    dataset: CutoutDataset,
) -> _ResolvedAperture:
    aperture_radius = float(np.clip(source.aperture_radius, 1.0, 6.0))
    inner_annulus = float(np.clip(source.inner_annulus, aperture_radius + 0.5, 7.0))
    outer_annulus = float(
        np.clip(
            source.outer_annulus,
            inner_annulus + 0.5,
            min(dataset.flux_cube.shape[1:]) / 1.8,
        )
    )
    return _ResolvedAperture(
        position=source.position,
        aperture_radius=aperture_radius,
        inner_annulus=inner_annulus,
        outer_annulus=outer_annulus,
    )


def _robust_mad(values: np.ndarray) -> float:
    finite_values = np.asarray(values, dtype=np.float64)
    finite_values = finite_values[np.isfinite(finite_values)]
    if finite_values.size == 0:
        return 0.0
    median = np.nanmedian(finite_values)
    return float(np.nanmedian(np.abs(finite_values - median)))


def _build_light_curve_response(
    target_id: str,
    period_days: float | None,
    times: np.ndarray,
    fluxes: np.ndarray,
    *,
    y_label: str,
    max_points: int | None = None,
) -> LightCurveResponse:
    sampled_times = np.asarray(times, dtype=np.float64)
    sampled_fluxes = np.asarray(fluxes, dtype=np.float64)
    if max_points is not None and sampled_times.size > max_points:
        sample_indices = np.linspace(0, sampled_times.size - 1, max_points, dtype=int)
        sampled_times = sampled_times[sample_indices]
        sampled_fluxes = sampled_fluxes[sample_indices]

    point_error = max(_estimate_light_curve_point_error(sampled_fluxes), 0.0005)
    points = [
        LightCurvePoint(
            hjd=round(float(time_value), 6),
            phase=None,
            magnitude=round(float(flux_value), 6),
            mag_error=round(point_error, 6),
        )
        for time_value, flux_value in zip(sampled_times, sampled_fluxes, strict=False)
    ]
    return LightCurveResponse(
        target_id=target_id,
        period_days=period_days,
        points=points,
        x_label="BTJD",
        y_label=y_label,
    )


def _estimate_light_curve_point_error(fluxes: np.ndarray) -> float:
    finite_fluxes = np.asarray(fluxes, dtype=np.float64)
    finite_fluxes = finite_fluxes[np.isfinite(finite_fluxes)]
    if finite_fluxes.size < 3:
        return float(np.nanstd(finite_fluxes)) if finite_fluxes.size > 0 else 0.0005

    diffs = np.diff(finite_fluxes)
    diffs = diffs[np.isfinite(diffs)]
    if diffs.size < 2:
        scatter = _robust_mad(finite_fluxes)
        return float(max(scatter * 1.4826, 0.0005))

    # First differences suppress the transit shape itself and better capture
    # cadence-to-cadence white noise than the global light-curve scatter.
    diff_scatter = _robust_mad(diffs) * 1.4826 / np.sqrt(2.0)
    if np.isfinite(diff_scatter) and diff_scatter > 0:
        return float(diff_scatter)

    scatter = _robust_mad(finite_fluxes) * 1.4826
    if np.isfinite(scatter) and scatter > 0:
        return float(scatter)
    return float(max(np.nanstd(finite_fluxes), 0.0005))


def _load_cutout_dataset(
    target_id: str,
    observation_id: str,
    ra: float,
    dec: float,
    sector: int,
    camera: int | None,
    ccd: int | None,
    cutout_url: str,
    size_px: int,
    progress_callback: Callable[[float, str], None] | None = None,
) -> CutoutDataset:
    cache_key = (target_id, observation_id, sector, size_px)

    with _cutout_cache_lock:
        _prune_hot_cutout_cache()
        cached = _cutout_cache.get(cache_key)
        if cached is not None:
            _cutout_cache.move_to_end(cache_key)
            _notify_progress(progress_callback, 0.4, "Using cached TESS cutout.")
            return cached
        hot_entry = _hot_cutout_cache.get(cache_key)
        if hot_entry is not None:
            _hot_cutout_cache.move_to_end(cache_key)
            _notify_progress(progress_callback, 0.4, "Reusing recently loaded TESS cutout.")
            return hot_entry[1]

    cached_fits_path = _disk_cutout_cache_path(cache_key)
    if cached_fits_path is not None and cached_fits_path.exists():
        _notify_progress(progress_callback, 0.12, "Loading cached TESS cutout from local disk.")
        try:
            dataset = _dataset_from_fits_path(
                target_id=target_id,
                observation_id=observation_id,
                sector=sector,
                camera=camera,
                ccd=ccd,
                size_px=size_px,
                cutout_url=cutout_url,
                ra=ra,
                dec=dec,
                fits_path=cached_fits_path,
                progress_callback=progress_callback,
            )
            _store_cutout_dataset(cache_key, dataset)
            return dataset
        except Exception as error:
            logger.warning("Failed to restore disk-cached TESS cutout %s: %s", cached_fits_path, error)
            cached_fits_path.unlink(missing_ok=True)

    _notify_progress(
        progress_callback,
        0.05,
        "Requesting and staging the TESS cutout on MAST.",
    )
    payload = json.dumps(
        {
            "ra": ra,
            "dec": dec,
            "x": size_px,
            "y": size_px,
            "units": "px",
            "sector": sector,
        }
    ).encode("utf-8")
    request = Request(
        _TESSCUT_ASTROCUT_URL,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    temp_zip_path: Path | None = None
    try:
        _ensure_transit_stage_dir()
        _prune_transit_stage_dir()
        with tempfile.NamedTemporaryFile(
            dir=_TRANSIT_STAGE_DIR,
            suffix=".zip",
            delete=False,
        ) as temp_zip_file:
            temp_zip_path = Path(temp_zip_file.name)
            with urlopen(request, timeout=120) as response:
                content_length = response.headers.get("Content-Length")
                total_bytes = (
                    int(content_length) if content_length and content_length.isdigit() else 0
                )
                bytes_read = 0

                while True:
                    chunk = response.read(1024 * 256)
                    if not chunk:
                        break
                    temp_zip_file.write(chunk)
                    bytes_read += len(chunk)
                    if total_bytes > 0:
                        fraction = bytes_read / total_bytes
                        _notify_progress(
                            progress_callback,
                            0.08 + 0.7 * fraction,
                            f"Downloading TESS cutout ZIP ({fraction * 100:.0f}%).",
                        )

        _notify_progress(progress_callback, 0.82, "Extracting FITS data from cutout ZIP.")
        _extract_disk_cutout_cache(temp_zip_path, cached_fits_path)
        fits_path = cached_fits_path if cached_fits_path is not None else _extract_temp_fits_from_zip(temp_zip_path)
        dataset = _dataset_from_fits_path(
            target_id=target_id,
            observation_id=observation_id,
            sector=sector,
            camera=camera,
            ccd=ccd,
            size_px=size_px,
            cutout_url=cutout_url,
            ra=ra,
            dec=dec,
            fits_path=fits_path,
            progress_callback=progress_callback,
        )
        _store_cutout_dataset(cache_key, dataset)
        return dataset
    finally:
        if temp_zip_path is not None:
            temp_zip_path.unlink(missing_ok=True)
        if not _is_disk_cutout_cache_enabled():
            try:
                if 'fits_path' in locals():
                    Path(fits_path).unlink(missing_ok=True)
            except OSError:
                pass


def _dataset_from_fits_path(
    *,
    target_id: str,
    observation_id: str,
    sector: int,
    camera: int | None,
    ccd: int | None,
    size_px: int,
    cutout_url: str,
    ra: float,
    dec: float,
    fits_path: Path,
    progress_callback: Callable[[float, str], None] | None = None,
) -> CutoutDataset:
    _notify_progress(progress_callback, 0.87, "Reading cadence cube from FITS file.")
    with fits.open(fits_path, memmap=False) as hdul:
        pixels = hdul["PIXELS"].data
        flux_cube = np.asarray(pixels["FLUX"], dtype=np.float32)
        times = np.asarray(pixels["TIME"], dtype=np.float64)
        aperture_header = hdul["APERTURE"].header
        target_position = _resolve_target_position(
            aperture_header,
            ra,
            dec,
            flux_cube.shape[2],
            flux_cube.shape[1],
        )
        try:
            wcs_obj = WCS(aperture_header)
        except Exception:
            wcs_obj = None
        column_names = set(getattr(pixels, "names", []) or [])
        cadence_numbers = (
            np.asarray(pixels["CADENCENO"], dtype=np.int64)
            if "CADENCENO" in column_names
            else None
        )
        quality_flags = (
            np.asarray(pixels["QUALITY"], dtype=np.int64)
            if "QUALITY" in column_names
            else None
        )

    return CutoutDataset(
        target_id=target_id,
        observation_id=observation_id,
        sector=sector,
        camera=camera,
        ccd=ccd,
        size_px=size_px,
        cutout_url=cutout_url,
        times=times,
        flux_cube=flux_cube,
        target_position=target_position,
        cadence_numbers=cadence_numbers,
        quality_flags=quality_flags,
        wcs=wcs_obj,
    )


def _disk_cutout_cache_path(cache_key: tuple[str, str, int, int]) -> Path | None:
    if not _is_disk_cutout_cache_enabled():
        return None
    target_id, observation_id, sector, size_px = cache_key
    filename = f"{target_id}__{observation_id}__s{sector:04d}__{size_px}px.fits"
    return _DISK_CUTOUT_CACHE_DIR / filename


def _extract_temp_fits_from_zip(zip_path: Path) -> Path:
    _ensure_transit_stage_dir()
    with zipfile.ZipFile(zip_path) as archive_file:
        fits_name = next(name for name in archive_file.namelist() if name.lower().endswith(".fits"))
        with archive_file.open(fits_name) as source, tempfile.NamedTemporaryFile(
            dir=_TRANSIT_STAGE_DIR,
            suffix=".fits",
            delete=False,
        ) as temp_fits_file:
            temp_path = Path(temp_fits_file.name)
            shutil.copyfileobj(source, temp_fits_file)
    return temp_path


def _extract_disk_cutout_cache(zip_path: Path, cache_path: Path | None) -> None:
    if cache_path is None or not _is_disk_cutout_cache_enabled():
        return
    try:
        _DISK_CUTOUT_CACHE_DIR.mkdir(parents=True, exist_ok=True)
        if cache_path.exists():
            return

        with zipfile.ZipFile(zip_path) as archive_file:
            fits_name = next(
                name for name in archive_file.namelist() if name.lower().endswith(".fits")
            )
            with archive_file.open(fits_name) as source, tempfile.NamedTemporaryFile(
                dir=_DISK_CUTOUT_CACHE_DIR,
                suffix=".fits",
                delete=False,
            ) as temp_fits_file:
                temp_cache_path = Path(temp_fits_file.name)
                shutil.copyfileobj(source, temp_fits_file)

        try:
            temp_cache_path.replace(cache_path)
        except FileExistsError:
            temp_cache_path.unlink(missing_ok=True)
    except OSError as error:
        logger.warning("Failed to stage disk-cached TESS cutout %s: %s", cache_path, error)


def _store_cutout_dataset(
    cache_key: tuple[str, str, int, int],
    dataset: CutoutDataset,
) -> None:
    dataset_bytes = _dataset_nbytes(dataset)

    with _cutout_cache_lock:
        _prune_hot_cutout_cache()
        _hot_cutout_cache.pop(cache_key, None)

        # Keep the most recent oversized cutout in memory so preview -> photometry
        # can reuse it without forcing another TESSCut download.
        if dataset_bytes > _CUTOUT_CACHE_MAX_BYTES:
            _hot_cutout_cache[cache_key] = (time.time(), dataset)
            while len(_hot_cutout_cache) > _HOT_CUTOUT_CACHE_MAX_ITEMS:
                _hot_cutout_cache.popitem(last=False)
            return

        existing = _cutout_cache.pop(cache_key, None)
        current_bytes = _cache_nbytes()

        if existing is not None:
            current_bytes -= _dataset_nbytes(existing)

        while _cutout_cache and (
            len(_cutout_cache) >= _CUTOUT_CACHE_MAX_ITEMS
            or current_bytes + dataset_bytes > _CUTOUT_CACHE_MAX_BYTES
        ):
            _, evicted = _cutout_cache.popitem(last=False)
            current_bytes -= _dataset_nbytes(evicted)

        _cutout_cache[cache_key] = dataset


def _cache_nbytes() -> int:
    return sum(_dataset_nbytes(dataset) for dataset in _cutout_cache.values())


def _prune_hot_cutout_cache() -> None:
    now = time.time()
    expired = [
        cache_key
        for cache_key, (created_at, _) in _hot_cutout_cache.items()
        if now - created_at > _HOT_CUTOUT_CACHE_TTL_SECONDS
    ]
    for cache_key in expired:
        _hot_cutout_cache.pop(cache_key, None)


def _store_preview_dataset_token(dataset: CutoutDataset) -> str:
    token = uuid.uuid4().hex
    with _cutout_cache_lock:
        _prune_preview_dataset_tokens()
        _preview_dataset_tokens[token] = (time.time(), dataset)
        while len(_preview_dataset_tokens) > _PREVIEW_DATASET_TOKEN_MAX_ITEMS:
            _preview_dataset_tokens.popitem(last=False)
    return token


def _restore_preview_dataset_token(
    token: str | None,
    *,
    target_id: str,
    observation_id: str,
    size_px: int,
) -> CutoutDataset | None:
    if not token:
        return None

    with _cutout_cache_lock:
        _prune_preview_dataset_tokens()
        entry = _preview_dataset_tokens.get(token)
        if entry is None:
            return None
        created_at, dataset = entry
        if (
            dataset.target_id != target_id
            or dataset.observation_id != observation_id
            or dataset.size_px != size_px
        ):
            return None
        _preview_dataset_tokens.move_to_end(token)
        _preview_dataset_tokens[token] = (created_at, dataset)
        return dataset


def _prune_preview_dataset_tokens() -> None:
    now = time.time()
    expired = [
        token
        for token, (created_at, _) in _preview_dataset_tokens.items()
        if now - created_at > _PREVIEW_DATASET_TOKEN_TTL_SECONDS
    ]
    for token in expired:
        _preview_dataset_tokens.pop(token, None)


def _dataset_nbytes(dataset: CutoutDataset) -> int:
    return int(dataset.times.nbytes + dataset.flux_cube.nbytes)


def _run_preview_job(job_id: str) -> None:
    with _preview_job_lock:
        state = _preview_jobs.get(job_id)
        if state is None:
            return
        state["status"] = "running"
        state["progress"] = 0.02
        state["message"] = "Starting preview job."
        target_id = state["target_id"]
        observation_id = state["observation_id"]
        size_px = state["size_px"]
        frame_index = state.get("frame_index")

    def update_progress(progress: float, message: str) -> None:
        with _preview_job_lock:
            current = _preview_jobs.get(job_id)
            if current is None:
                raise PreviewJobCancelled
            if current["cancel_requested"]:
                raise PreviewJobCancelled
            current["status"] = "running"
            current["progress"] = max(0.0, min(1.0, progress))
            current["message"] = message

    try:
        preview = get_cutout_preview(
            target_id,
            observation_id,
            size_px=size_px,
            frame_index=frame_index,
            progress_callback=update_progress,
        )
    except PreviewJobCancelled:
        with _preview_job_lock:
            current = _preview_jobs.get(job_id)
            if current is not None:
                current["status"] = "cancelled"
                current["message"] = "Preview request cancelled."
                current["result"] = None
        return
    except Exception as error:
        with _preview_job_lock:
            current = _preview_jobs.get(job_id)
            if current is not None:
                current["status"] = "failed"
                current["error"] = str(error)
                current["message"] = "Failed to prepare TESS cutout preview."
        return

    with _preview_job_lock:
        current = _preview_jobs.get(job_id)
        if current is None:
            return
        current["status"] = "completed"
        current["progress"] = 1.0
        current["message"] = "Transit cutout preview ready."
        current["result"] = preview


def _serialize_preview_job(state: dict) -> TransitPreviewJobResponse:
    return TransitPreviewJobResponse(
        job_id=state["job_id"],
        status=state["status"],
        progress=float(state["progress"]),
        message=state["message"],
        result=state["result"],
        error=state["error"],
    )


def _prune_preview_jobs() -> None:
    now = time.time()
    expired = [
        job_id
        for job_id, state in _preview_jobs.items()
        if now - state["created_at"] > TRANSIT_PREVIEW_JOB_TTL_SECONDS
    ]
    for job_id in expired:
        _preview_jobs.pop(job_id, None)


def _enforce_preview_job_capacity() -> None:
    while len(_preview_jobs) >= TRANSIT_PREVIEW_JOB_MAX_ITEMS:
        removable_job_id = next(
            (
                job_id
                for job_id, state in _preview_jobs.items()
                if state["status"] in {"completed", "failed", "cancelled"}
            ),
            None,
        )
        if removable_job_id is None:
            raise PreviewCapacityError(
                "Preview queue is busy. Try again after current jobs finish."
            )
        _preview_jobs.pop(removable_job_id, None)


def _notify_progress(
    progress_callback: Callable[[float, str], None] | None,
    progress: float,
    message: str,
) -> None:
    if progress_callback is not None:
        progress_callback(progress, message)


def _build_preview_data_url(
    flux_cube: np.ndarray,
    quality_flags: np.ndarray | None = None,
    frame_index: int | None = None,
) -> tuple[str, int | None, str]:
    image, preview_mode, resolved_frame_index = _resolve_preview_image(
        flux_cube,
        quality_flags=quality_flags,
        frame_index=frame_index,
    )
    finite_pixels = image[np.isfinite(image)]

    if finite_pixels.size == 0:
        image = np.zeros(flux_cube.shape[1:], dtype=np.float32)
        finite_pixels = np.array([0.0, 1.0], dtype=np.float32)

    low, high = np.percentile(finite_pixels, [8, 99.7])
    if high <= low:
        high = low + 1.0

    normalized = np.clip((image - low) / (high - low), 0.0, 1.0)
    normalized = np.where(np.isfinite(image), normalized, 0.06)
    stretched = np.arcsinh(normalized * 10.0) / np.arcsinh(10.0)
    rgb = np.stack(
        [
            stretched * 255,
            np.power(stretched, 0.85) * 210 + 20,
            np.power(stretched, 0.65) * 180 + 35,
        ],
        axis=-1,
    ).astype(np.uint8)
    preview = Image.fromarray(rgb, mode="RGB").resize(
        (_PREVIEW_SIZE_PX, _PREVIEW_SIZE_PX),
        resample=Image.Resampling.NEAREST,
    )

    buffer = io.BytesIO()
    preview.save(buffer, format="PNG")
    encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
    return preview_mode, resolved_frame_index, f"data:image/png;base64,{encoded}"


def _resolve_preview_image(
    flux_cube: np.ndarray,
    quality_flags: np.ndarray | None = None,
    frame_index: int | None = None,
) -> tuple[np.ndarray, str, int | None]:
    frame_count = int(flux_cube.shape[0])
    if frame_count <= 0:
        return np.zeros(flux_cube.shape[1:], dtype=np.float32), "median", None

    if frame_index is None:
        frame_index = _best_frame_index(flux_cube, quality_flags)

    resolved_frame_index = max(0, min(frame_count - 1, int(frame_index)))
    frame = np.asarray(flux_cube[resolved_frame_index], dtype=np.float32)
    if np.isfinite(frame).any():
        return frame, "frame", resolved_frame_index

    finite_cube = np.where(np.isfinite(flux_cube), flux_cube, np.nan)
    median_image = np.nanmedian(finite_cube, axis=0)
    return median_image, "median", None


def _best_frame_index(
    flux_cube: np.ndarray,
    quality_flags: np.ndarray | None = None,
) -> int:
    frame_count = int(flux_cube.shape[0])
    if frame_count <= 0:
        return 0

    finite_counts = np.isfinite(flux_cube).sum(axis=(1, 2))
    candidates = np.where(finite_counts > 0)[0]
    if candidates.size == 0:
        return 0

    if quality_flags is not None and len(quality_flags) == frame_count:
        zero_quality = candidates[quality_flags[candidates] == 0]
        if zero_quality.size > 0:
            candidates = zero_quality

    max_finite = finite_counts[candidates].max()
    top = candidates[finite_counts[candidates] == max_finite]
    center = (frame_count - 1) / 2
    return int(top[np.argmin(np.abs(top - center))])


def _build_frame_metadata(
    dataset: CutoutDataset,
    frame_index: int | None,
) -> TransitFrameMetadata | None:
    if frame_index is None:
        return None

    resolved_index = max(0, min(int(dataset.flux_cube.shape[0]) - 1, int(frame_index)))
    frame = np.asarray(dataset.flux_cube[resolved_index], dtype=np.float32)
    finite_mask = np.isfinite(frame)
    finite_pixels = int(finite_mask.sum())
    total_pixels = int(frame.size)
    finite_fraction = finite_pixels / total_pixels if total_pixels else None
    finite_values = frame[finite_mask]

    return TransitFrameMetadata(
        frame_index=resolved_index,
        btjd=round(float(dataset.times[resolved_index]), 6)
        if resolved_index < len(dataset.times) and np.isfinite(dataset.times[resolved_index])
        else None,
        cadence_number=int(dataset.cadence_numbers[resolved_index])
        if dataset.cadence_numbers is not None and resolved_index < len(dataset.cadence_numbers)
        else None,
        quality_flag=int(dataset.quality_flags[resolved_index])
        if dataset.quality_flags is not None and resolved_index < len(dataset.quality_flags)
        else None,
        finite_fraction=round(float(finite_fraction), 4) if finite_fraction is not None else None,
        finite_pixels=finite_pixels,
        total_pixels=total_pixels,
        flux_min=round(float(np.nanmin(finite_values)), 3) if finite_values.size else None,
        flux_median=round(float(np.nanmedian(finite_values)), 3) if finite_values.size else None,
        flux_max=round(float(np.nanmax(finite_values)), 3) if finite_values.size else None,
    )


def _resolve_target_position(
    aperture_header,
    ra: float,
    dec: float,
    width: int,
    height: int,
) -> PixelCoordinate:
    try:
        wcs = WCS(aperture_header)
        sky_coord = SkyCoord(ra=ra * u.deg, dec=dec * u.deg)
        pixel_x, pixel_y = wcs.all_world2pix([[sky_coord.ra.deg, sky_coord.dec.deg]], 0)[0]
        return PixelCoordinate(
            x=float(np.clip(pixel_x + 0.5, 0.5, width - 0.5)),
            y=float(np.clip(pixel_y + 0.5, 0.5, height - 0.5)),
        )
    except Exception:
        return PixelCoordinate(x=width / 2, y=height / 2)


def _first_valid_frame_index(flux_cube: np.ndarray) -> int:
    return _best_frame_index(flux_cube, None)
    return 0


def _sample_frame_indices(frame_count: int) -> list[int]:
    if frame_count <= 0:
        return []
    anchors = [0, frame_count // 4, frame_count // 2, (3 * frame_count) // 4, frame_count - 1]
    return list(dict.fromkeys(max(0, min(frame_count - 1, value)) for value in anchors))


def _extract_net_flux(
    flux_cube: np.ndarray,
    center: PixelCoordinate,
    aperture_radius: float,
    inner_annulus: float,
    outer_annulus: float,
) -> np.ndarray:
    height, width = flux_cube.shape[1:]
    aperture_mask = _circular_mask(width, height, center.x, center.y, aperture_radius)
    annulus_mask = _annulus_mask(
        width,
        height,
        center.x,
        center.y,
        inner_annulus,
        outer_annulus,
    )

    raw_flux = np.nansum(flux_cube[:, aperture_mask], axis=1)
    annulus_values = flux_cube[:, annulus_mask]

    with np.errstate(invalid="ignore", all="ignore"):
        sky_per_pixel = np.nanmedian(annulus_values, axis=1)

    sky_flux = sky_per_pixel * max(int(aperture_mask.sum()), 1)
    net_flux = raw_flux - sky_flux
    net_flux[~np.isfinite(net_flux)] = np.nan
    return net_flux


def _circular_mask(
    width: int,
    height: int,
    center_x: float,
    center_y: float,
    radius: float,
) -> np.ndarray:
    y_indices, x_indices = np.indices((height, width), dtype=float)
    return ((x_indices + 0.5 - center_x) ** 2 + (y_indices + 0.5 - center_y) ** 2) <= (
        radius**2
    )


def _annulus_mask(
    width: int,
    height: int,
    center_x: float,
    center_y: float,
    inner_radius: float,
    outer_radius: float,
) -> np.ndarray:
    y_indices, x_indices = np.indices((height, width), dtype=float)
    distance_sq = (x_indices + 0.5 - center_x) ** 2 + (y_indices + 0.5 - center_y) ** 2
    return (distance_sq >= inner_radius**2) & (distance_sq <= outer_radius**2)
