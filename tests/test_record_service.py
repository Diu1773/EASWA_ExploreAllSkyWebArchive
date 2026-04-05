import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BACKEND_DIR = ROOT / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from schemas.lightcurve import LightCurvePoint, LightCurveResponse
from schemas.transit import TransitPhotometryResponse
from services import record_service


def test_export_transit_record_csv_for_user_replays_saved_photometry(monkeypatch):
    saved_record = {
        "id": 12,
        "workflow": "transit_lab",
        "template_id": "transit_record",
        "target_id": "wasp_52_b",
        "observation_ids": ["wasp_52_b_sector_0042"],
        "title": "WASP-52 b Sector 42",
        "payload": {
            "context": {
                "observation_id": "wasp_52_b_sector_0042",
                "field_size_px": 35,
                "target_context": {
                    "ra": 348.4947931,
                    "dec": 8.7610793,
                    "period_days": 1.7497798,
                },
                "observation_context": {
                    "sector": 42,
                    "camera": 2,
                    "ccd": 3,
                },
                "target_position": {"x": 30.7, "y": 30.5},
                "target_aperture": {
                    "position": {"x": 30.7, "y": 30.5},
                    "aperture_radius": 2.5,
                    "inner_annulus": 4.0,
                    "outer_annulus": 6.0,
                },
                "comparison_positions": [{"x": 45.5, "y": 40.5}],
                "comparison_apertures": [
                    {
                        "position": {"x": 45.5, "y": 40.5},
                        "aperture_radius": 2.75,
                        "inner_annulus": 4.25,
                        "outer_annulus": 6.25,
                    }
                ],
                "aperture": {
                    "apertureRadius": 2.5,
                    "innerAnnulus": 4.0,
                    "outerAnnulus": 6.0,
                },
                "transit_fit": {
                    "period": 1.7497798,
                    "t0": 2702.4,
                },
            }
        },
    }
    captured = {}

    monkeypatch.setattr(
        record_service,
        "get_analysis_record",
        lambda record_id, user_id: saved_record if record_id == 12 and user_id == 7 else None,
    )

    def fake_run_transit_photometry(req):
        captured["request"] = req
        return TransitPhotometryResponse(
            target_id=req.target_id,
            observation_id=req.observation_id,
            sector=42,
            frame_count=2,
            comparison_count=1,
            target_position=req.target_position,
            comparison_positions=req.comparison_positions,
            target_median_flux=123.4,
            comparison_median_flux=456.7,
            comparison_diagnostics=[],
            light_curve=LightCurveResponse(
                target_id=req.target_id,
                period_days=req.target_context.period_days if req.target_context else None,
                points=[
                    LightCurvePoint(hjd=2702.35, phase=None, magnitude=0.98, mag_error=0.002),
                    LightCurvePoint(hjd=2702.40, phase=None, magnitude=0.95, mag_error=0.002),
                ],
                x_label="BTJD",
                y_label="Normalized Flux",
            ),
        )

    monkeypatch.setattr(record_service.transit_service, "run_transit_photometry", fake_run_transit_photometry)

    filename, csv_text = record_service.export_transit_record_csv_for_user(12, 7)

    assert filename.endswith("_lightcurve.csv")
    assert "record_id,target_id,observation_id,sector,btjd,normalized_flux,flux_error,phase" in csv_text
    assert "12,wasp_52_b,wasp_52_b_sector_0042,42,2702.35,0.98,0.002," in csv_text
    request = captured["request"]
    assert request.target_context is not None
    assert request.target_context.ra == 348.4947931
    assert request.observation_context is not None
    assert request.observation_context.sector == 42
    assert len(request.comparison_positions) == 1
    assert request.target_aperture is not None
    assert request.target_aperture.aperture_radius == 2.5
    assert len(request.comparison_apertures) == 1
    assert request.comparison_apertures[0].aperture_radius == 2.75


def test_delete_record_for_user_raises_when_missing(monkeypatch):
    monkeypatch.setattr(record_service, "delete_analysis_record", lambda record_id, user_id: False)

    try:
        record_service.delete_record_for_user(99, 7)
    except ValueError as error:
        assert str(error) == "Analysis record not found."
    else:
        raise AssertionError("Expected delete_record_for_user to raise ValueError")
