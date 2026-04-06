import sys
from pathlib import Path

import numpy as np


ROOT = Path(__file__).resolve().parents[1]
BACKEND_DIR = ROOT / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from schemas.transit import (
    PixelCoordinate,
    TransitApertureConfig,
    TransitObservationContext,
    TransitPhotometryRequest,
    TransitTargetContext,
)
from services import transit_service


class FakeWCS:
    def all_world2pix(self, coords, origin):
        results = []
        for ra, dec in coords:
            x = 30.0 + (float(ra) - 100.0) * 500.0
            y = 30.0 + (float(dec) - 20.0) * 500.0
            results.append([x, y])
        return np.asarray(results, dtype=float)


def test_query_tic_stars_filters_out_edge_and_blank_candidates(monkeypatch):
    monkeypatch.setattr(
        transit_service,
        "_query_tic_rows",
        lambda ra, dec, radius: [
            {"ID": 1, "ra": 100.0020, "dec": 20.0020, "Tmag": 11.0, "disposition": None},
            {"ID": 2, "ra": 100.0280, "dec": 20.0280, "Tmag": 11.5, "disposition": None},
            {"ID": 3, "ra": 100.0500, "dec": 20.0000, "Tmag": 12.0, "disposition": None},
        ],
    )

    image = np.zeros((60, 60), dtype=np.float32)
    image[29:32, 29:32] = 10.0
    coverage = np.ones((60, 60), dtype=np.float32)
    coverage[40:60, 40:60] = 0.4

    stars = transit_service._query_tic_stars(
        ra=100.0,
        dec=20.0,
        radius_arcmin=10.0,
        target_tmag=11.5,
        wcs_obj=FakeWCS(),
        reference_image=image,
        finite_coverage=coverage,
    )

    assert [star.tic_id for star in stars] == ["1"]
    assert stars[0].recommended is True


def test_query_tic_stars_deduplicates_target_overlap_and_same_pixel_candidates(monkeypatch):
    monkeypatch.setattr(
        transit_service,
        "_query_tic_rows",
        lambda ra, dec, radius: [
            {"ID": 1, "ra": 100.0001, "dec": 20.0001, "Tmag": 11.0, "disposition": None},
            {"ID": 2, "ra": 100.0040, "dec": 20.0040, "Tmag": 11.5, "disposition": None},
            {"ID": 3, "ra": 100.0040, "dec": 20.0040, "Tmag": 11.7, "disposition": None},
        ],
    )

    image = np.zeros((60, 60), dtype=np.float32)
    image[31:34, 31:34] = 10.0
    coverage = np.ones((60, 60), dtype=np.float32)

    stars = transit_service._query_tic_stars(
        ra=100.0,
        dec=20.0,
        radius_arcmin=10.0,
        target_tmag=11.5,
        wcs_obj=FakeWCS(),
        reference_image=image,
        finite_coverage=coverage,
    )

    assert [star.tic_id for star in stars] == ["2"]
    assert stars[0].recommended is True


def test_run_transit_photometry_uses_request_context_without_archive_lookup(monkeypatch):
    def fail_target_lookup(*args, **kwargs):
        raise AssertionError("archive target lookup should not be called")

    def fail_observation_lookup(*args, **kwargs):
        raise AssertionError("archive observation lookup should not be called")

    monkeypatch.setattr(transit_service, "_require_target", fail_target_lookup)
    monkeypatch.setattr(transit_service, "_require_observation", fail_observation_lookup)
    monkeypatch.setattr(
        transit_service,
        "_load_cutout_dataset",
        lambda *args, **kwargs: transit_service.CutoutDataset(
            target_id="wasp_52_b",
            observation_id="wasp_52_b_sector_0042",
            sector=42,
            camera=2,
            ccd=3,
            size_px=35,
            cutout_url="",
            times=np.asarray([1.0, 2.0, 3.0], dtype=np.float64),
            flux_cube=np.ones((3, 20, 20), dtype=np.float32),
            target_position=PixelCoordinate(x=10.5, y=10.5),
            quality_flags=np.zeros(3, dtype=np.int64),
        ),
    )

    calls = []

    def fake_extract_net_flux(flux_cube, position, aperture_radius, inner_annulus, outer_annulus):
        calls.append((position.x, aperture_radius, inner_annulus, outer_annulus))
        if position.x < 4.0:
            return np.asarray([10.0, 11.0, 12.0], dtype=np.float32)
        return np.asarray([5.0, 5.0, 5.0], dtype=np.float32)

    monkeypatch.setattr(transit_service, "_extract_net_flux", fake_extract_net_flux)

    response = transit_service.run_transit_photometry(
        TransitPhotometryRequest(
            target_id="wasp_52_b",
            observation_id="wasp_52_b_sector_0042",
            cutout_size_px=35,
            target_context=TransitTargetContext(ra=348.4947931, dec=8.7610793, period_days=1.7497798),
            observation_context=TransitObservationContext(sector=42, camera=2, ccd=3),
            target_position=PixelCoordinate(x=3.5, y=3.5),
            comparison_positions=[PixelCoordinate(x=5.5, y=5.5)],
            aperture_radius=2.5,
            inner_annulus=4.0,
            outer_annulus=6.0,
            target_aperture=TransitApertureConfig(
                position=PixelCoordinate(x=3.5, y=3.5),
                aperture_radius=2.0,
                inner_annulus=3.5,
                outer_annulus=5.5,
            ),
            comparison_apertures=[
                TransitApertureConfig(
                    position=PixelCoordinate(x=5.5, y=5.5),
                    aperture_radius=3.0,
                    inner_annulus=4.5,
                    outer_annulus=6.5,
                )
            ],
        )
    )

    assert response.sector == 42
    assert response.frame_count == 3
    assert response.comparison_count == 1
    assert response.light_curve.period_days == 1.7497798
    assert len(response.light_curve.points) == 3
    assert len(response.comparison_diagnostics) == 1
    assert response.comparison_diagnostics[0].label == "C1"
    assert calls[0] == (3.5, 2.0, 3.5, 5.5)
    assert calls[1] == (5.5, 3.0, 4.5, 6.5)


def test_run_transit_photometry_reports_real_progress(monkeypatch):
    def fake_load_cutout_dataset(*args, progress_callback=None, **kwargs):
        if progress_callback is not None:
            progress_callback(0.5, "Loading cutout dataset.")
        return transit_service.CutoutDataset(
            target_id="wasp_52_b",
            observation_id="wasp_52_b_sector_0042",
            sector=42,
            camera=2,
            ccd=3,
            size_px=35,
            cutout_url="",
            times=np.asarray([1.0, 2.0, 3.0], dtype=np.float64),
            flux_cube=np.ones((3, 20, 20), dtype=np.float32),
            target_position=PixelCoordinate(x=10.5, y=10.5),
            quality_flags=np.zeros(3, dtype=np.int64),
        )

    monkeypatch.setattr(transit_service, "_load_cutout_dataset", fake_load_cutout_dataset)
    monkeypatch.setattr(
        transit_service,
        "_extract_net_flux",
        lambda *args, **kwargs: np.asarray([10.0, 11.0, 12.0], dtype=np.float32),
    )

    events: list[tuple[float, str]] = []
    response = transit_service.run_transit_photometry(
        TransitPhotometryRequest(
            target_id="wasp_52_b",
            observation_id="wasp_52_b_sector_0042",
            cutout_size_px=35,
            target_context=TransitTargetContext(
                ra=348.4947931,
                dec=8.7610793,
                period_days=1.7497798,
            ),
            observation_context=TransitObservationContext(sector=42, camera=2, ccd=3),
            target_position=PixelCoordinate(x=3.5, y=3.5),
            comparison_positions=[PixelCoordinate(x=5.5, y=5.5)],
        ),
        progress_callback=lambda pct, message: events.append((pct, message)),
    )

    assert response.frame_count == 3
    assert len(events) >= 4
    assert events[0][1] == "Resolving target and observation context."
    assert any("Loading cutout dataset." in message for _, message in events)
    assert events[-1] == (1.0, "Transit photometry complete.")


def test_run_transit_photometry_reuses_preview_dataset_token(monkeypatch):
    transit_service._preview_dataset_tokens.clear()

    dataset = transit_service.CutoutDataset(
        target_id="wasp_52_b",
        observation_id="wasp_52_b_sector_0042",
        sector=42,
        camera=2,
        ccd=3,
        size_px=35,
        cutout_url="",
        times=np.asarray([1.0, 2.0, 3.0], dtype=np.float64),
        flux_cube=np.ones((3, 20, 20), dtype=np.float32),
        target_position=PixelCoordinate(x=10.5, y=10.5),
        quality_flags=np.zeros(3, dtype=np.int64),
    )
    token = transit_service._store_preview_dataset_token(dataset)

    def fail_load_cutout_dataset(*args, **kwargs):
        raise AssertionError("cutout download should not run when preview dataset token is valid")

    monkeypatch.setattr(transit_service, "_load_cutout_dataset", fail_load_cutout_dataset)
    monkeypatch.setattr(
        transit_service,
        "_extract_net_flux",
        lambda *args, **kwargs: np.asarray([10.0, 11.0, 12.0], dtype=np.float32),
    )

    events: list[tuple[float, str]] = []
    response = transit_service.run_transit_photometry(
        TransitPhotometryRequest(
            target_id="wasp_52_b",
            observation_id="wasp_52_b_sector_0042",
            cutout_size_px=35,
            preview_dataset_token=token,
            target_context=TransitTargetContext(
                ra=348.4947931,
                dec=8.7610793,
                period_days=1.7497798,
            ),
            observation_context=TransitObservationContext(sector=42, camera=2, ccd=3),
            target_position=PixelCoordinate(x=3.5, y=3.5),
            comparison_positions=[PixelCoordinate(x=5.5, y=5.5)],
        ),
        progress_callback=lambda pct, message: events.append((pct, message)),
    )

    assert response.frame_count == 3
    assert any("Reusing cutout already loaded in step 1." in message for _, message in events)


def test_load_cutout_dataset_reuses_recent_oversized_cutout(monkeypatch):
    transit_service._cutout_cache.clear()
    transit_service._hot_cutout_cache.clear()
    monkeypatch.setattr(transit_service, "_CUTOUT_CACHE_MAX_BYTES", 1)
    monkeypatch.setattr(transit_service, "_HOT_CUTOUT_CACHE_MAX_ITEMS", 1)

    cache_key = ("wasp_52_b", "wasp_52_b_sector_0042", 42, 60)
    dataset = transit_service.CutoutDataset(
        target_id="wasp_52_b",
        observation_id="wasp_52_b_sector_0042",
        sector=42,
        camera=2,
        ccd=3,
        size_px=60,
        cutout_url="",
        times=np.asarray([1.0, 2.0, 3.0], dtype=np.float64),
        flux_cube=np.ones((3, 60, 60), dtype=np.float32),
        target_position=PixelCoordinate(x=30.5, y=30.5),
        quality_flags=np.zeros(3, dtype=np.int64),
    )

    transit_service._store_cutout_dataset(cache_key, dataset)

    assert cache_key not in transit_service._cutout_cache
    assert cache_key in transit_service._hot_cutout_cache

    def fail_urlopen(*args, **kwargs):
        raise AssertionError("urlopen should not be called when oversized cutout is reusable")

    monkeypatch.setattr(transit_service, "urlopen", fail_urlopen)

    reused = transit_service._load_cutout_dataset(
        target_id="wasp_52_b",
        observation_id="wasp_52_b_sector_0042",
        ra=348.4947931,
        dec=8.7610793,
        sector=42,
        camera=2,
        ccd=3,
        cutout_url="",
        size_px=60,
    )

    assert reused is dataset
