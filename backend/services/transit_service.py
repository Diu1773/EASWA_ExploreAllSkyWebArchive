from __future__ import annotations

import base64
import io
import json
import time
import uuid
import zipfile
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from threading import Lock
from typing import Callable
from urllib.request import Request, urlopen

import numpy as np
import astropy.units as u
from astropy.coordinates import SkyCoord
from astropy.io import fits
from astropy.wcs import WCS
from PIL import Image

from adapters.transit_archive import archive as transit_archive
from config import (
    TRANSIT_PREVIEW_JOB_MAX_ITEMS,
    TRANSIT_PREVIEW_JOB_TTL_SECONDS,
)
from schemas.lightcurve import LightCurvePoint, LightCurveResponse
from schemas.transit import (
    PixelCoordinate,
    TransitCutoutPreviewResponse,
    TransitFrameMetadata,
    TransitPhotometryRequest,
    TransitPhotometryResponse,
    TransitPreviewJobResponse,
)

_TESSCUT_ASTROCUT_URL = "https://mast.stsci.edu/tesscut/api/v0.1/astrocut"
_DEFAULT_CUTOUT_SIZE_PX = 35
_ALLOWED_CUTOUT_SIZES_PX = (30, 35, 40)
_PREVIEW_SIZE_PX = 456
_CUTOUT_CACHE_MAX_ITEMS = 4
_CUTOUT_CACHE_MAX_BYTES = 96 * 1024 * 1024


_cutout_cache_lock = Lock()
_cutout_cache: "OrderedDict[tuple[str, str, int, int], CutoutDataset]" = OrderedDict()
_preview_job_lock = Lock()
_preview_jobs: "OrderedDict[str, dict]" = OrderedDict()
_preview_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="tess-preview")


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


def _normalize_cutout_size(size_px: int | None) -> int:
    if size_px is None:
        return _DEFAULT_CUTOUT_SIZE_PX

    requested = int(size_px)
    return min(_ALLOWED_CUTOUT_SIZES_PX, key=lambda allowed: abs(allowed - requested))


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
    _notify_progress(progress_callback, 1.0, "Transit cutout preview ready.")

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
    )


def run_transit_photometry(req: TransitPhotometryRequest) -> TransitPhotometryResponse:
    target = _require_target(req.target_id)
    observation = _require_observation(req.target_id, req.observation_id)
    dataset = _load_cutout_dataset(
        req.target_id,
        req.observation_id,
        target["ra"],
        target["dec"],
        observation["sector"],
        observation.get("camera"),
        observation.get("ccd"),
        observation["cutout_url"],
        _normalize_cutout_size(req.cutout_size_px),
    )

    aperture_radius = float(np.clip(req.aperture_radius, 1.0, 6.0))
    inner_annulus = float(np.clip(req.inner_annulus, aperture_radius + 0.5, 7.0))
    outer_annulus = float(
        np.clip(
            req.outer_annulus,
            inner_annulus + 0.5,
            min(dataset.flux_cube.shape[1:]) / 1.8,
        )
    )

    target_flux = _extract_net_flux(
        dataset.flux_cube,
        req.target_position,
        aperture_radius,
        inner_annulus,
        outer_annulus,
    )

    comparison_fluxes = [
        _extract_net_flux(
            dataset.flux_cube,
            position,
            aperture_radius,
            inner_annulus,
            outer_annulus,
        )
        for position in req.comparison_positions[:3]
    ]

    finite_mask = np.isfinite(target_flux) & (target_flux > 0)
    if not finite_mask.any():
        raise ValueError("Target aperture did not produce any valid flux samples.")

    normalized_target = target_flux / np.nanmedian(target_flux[finite_mask])

    if comparison_fluxes:
        normalized_comparisons = []
        valid_comparison_fluxes = []
        for comparison_flux in comparison_fluxes:
            comparison_mask = np.isfinite(comparison_flux) & (comparison_flux > 0)
            if not comparison_mask.any():
                continue
            finite_mask &= comparison_mask
            valid_comparison_fluxes.append(comparison_flux)
            normalized_comparisons.append(
                comparison_flux / np.nanmedian(comparison_flux[comparison_mask])
            )

        if normalized_comparisons:
            comparison_reference = np.nanmean(
                np.vstack(normalized_comparisons),
                axis=0,
            )
            differential_flux = normalized_target / comparison_reference
            comparison_median_flux = float(
                np.nanmedian(np.sum(np.vstack(valid_comparison_fluxes), axis=0))
            )
        else:
            differential_flux = normalized_target
            comparison_median_flux = 0.0
    else:
        differential_flux = normalized_target
        comparison_median_flux = 0.0

    finite_mask &= np.isfinite(differential_flux) & (differential_flux > 0)
    if not finite_mask.any():
        raise ValueError("No valid cadences remained after comparison-star normalization.")

    times = dataset.times[finite_mask]
    normalized_flux = differential_flux[finite_mask]
    normalized_flux /= np.nanmedian(normalized_flux)

    scatter = float(np.nanstd(normalized_flux))
    point_error = max(scatter, 0.0005)

    points = [
        LightCurvePoint(
            hjd=round(float(time_value), 6),
            phase=None,
            magnitude=round(float(flux_value), 6),
            mag_error=round(point_error, 6),
        )
        for time_value, flux_value in zip(times, normalized_flux, strict=False)
    ]

    return TransitPhotometryResponse(
        target_id=req.target_id,
        observation_id=req.observation_id,
        sector=dataset.sector,
        frame_count=len(points),
        comparison_count=len(valid_comparison_fluxes) if comparison_fluxes else 0,
        target_position=req.target_position,
        comparison_positions=req.comparison_positions[:3],
        target_median_flux=round(float(np.nanmedian(target_flux[finite_mask])), 2),
        comparison_median_flux=round(comparison_median_flux, 2),
        light_curve=LightCurveResponse(
            target_id=req.target_id,
            period_days=target.get("period_days"),
            points=points,
            x_label="BTJD",
            y_label="Normalized Flux",
        ),
    )


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
        cached = _cutout_cache.get(cache_key)
        if cached is not None:
            _cutout_cache.move_to_end(cache_key)
            _notify_progress(progress_callback, 0.4, "Using cached TESS cutout.")
            return cached

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

    with urlopen(request, timeout=120) as response:
        content_length = response.headers.get("Content-Length")
        total_bytes = int(content_length) if content_length and content_length.isdigit() else 0
        bytes_read = 0
        buffer = io.BytesIO()

        while True:
            chunk = response.read(1024 * 256)
            if not chunk:
                break
            buffer.write(chunk)
            bytes_read += len(chunk)
            if total_bytes > 0:
                fraction = bytes_read / total_bytes
                _notify_progress(
                    progress_callback,
                    0.08 + 0.7 * fraction,
                    f"Downloading TESS cutout ZIP ({fraction * 100:.0f}%).",
                )

        zip_bytes = buffer.getvalue()

    _notify_progress(progress_callback, 0.82, "Extracting FITS data from cutout ZIP.")
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as archive_file:
        fits_name = next(
            name for name in archive_file.namelist() if name.lower().endswith(".fits")
        )
        fits_bytes = archive_file.read(fits_name)

    _notify_progress(progress_callback, 0.87, "Reading cadence cube from FITS file.")
    with fits.open(io.BytesIO(fits_bytes), memmap=False) as hdul:
        pixels = hdul["PIXELS"].data
        flux_cube = np.asarray(pixels["FLUX"], dtype=np.float32)
        times = np.asarray(pixels["TIME"], dtype=np.float64)
        target_position = _resolve_target_position(
            hdul["APERTURE"].header,
            ra,
            dec,
            flux_cube.shape[2],
            flux_cube.shape[1],
        )
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

    dataset = CutoutDataset(
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
    )
    _store_cutout_dataset(cache_key, dataset)
    return dataset


def _store_cutout_dataset(
    cache_key: tuple[str, str, int, int],
    dataset: CutoutDataset,
) -> None:
    dataset_bytes = _dataset_nbytes(dataset)

    # If a single dataset is larger than the budget, do not retain it.
    if dataset_bytes > _CUTOUT_CACHE_MAX_BYTES:
        return

    with _cutout_cache_lock:
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
