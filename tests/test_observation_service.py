import sys
from pathlib import Path
from urllib.parse import unquote


ROOT = Path(__file__).resolve().parents[1]
BACKEND_DIR = ROOT / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from services import observation_service
from services import transit_service


def test_list_observations_includes_transit_frame_counts(monkeypatch):
    target = {"id": "planet_x", "ra": 123.45, "dec": -54.32}
    raw_observations = [
        {
            "id": "planet_x_sector_0001",
            "target_id": "planet_x",
            "epoch": "2000-01-01T00:00:00Z",
            "hjd": 1.0,
            "filter_band": "TESS",
            "exposure_sec": 120.0,
            "thumbnail_url": "",
            "airmass": 0.0,
            "mission": "TESS",
            "sector": 1,
            "camera": 1,
            "ccd": 2,
            "display_label": "Sector 1",
            "display_subtitle": "Camera 1 · CCD 2",
            "cutout_url": "https://example.com/fits",
        },
        {
            "id": "planet_x_sector_0002",
            "target_id": "planet_x",
            "epoch": "2000-01-01T00:00:00Z",
            "hjd": 2.0,
            "filter_band": "TESS",
            "exposure_sec": 120.0,
            "thumbnail_url": "",
            "airmass": 0.0,
            "mission": "TESS",
            "sector": 2,
            "camera": 3,
            "ccd": 4,
            "display_label": "Sector 2",
            "display_subtitle": "Camera 3 · CCD 4",
            "cutout_url": "https://example.com/fits",
        },
    ]

    monkeypatch.setattr(observation_service.transit_archive, "get_target", lambda target_id: target)
    monkeypatch.setattr(
        observation_service.transit_archive,
        "list_observations",
        lambda target_id: raw_observations,
    )
    monkeypatch.setattr(
        observation_service.transit_service,
        "get_observation_frame_count",
        lambda target_id, ra, dec, observation: 1000 + int(observation["sector"]),
    )

    response = observation_service.list_observations("planet_x")

    assert [observation.frame_count for observation in response.observations] == [1001, 1002]


def test_query_tic_rows_uses_mast_request_payload(monkeypatch):
    transit_service._query_tic_rows.cache_clear()

    class DummyResponse:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def read(self):
            return b'{"data":[{"ID":1,"ra":1.0,"dec":2.0,"Tmag":10.0}]}'

    captured = {}

    def fake_urlopen(request, timeout=15):
        captured["url"] = request.full_url
        captured["data"] = request.data.decode("utf-8")
        captured["accept"] = request.get_header("Accept")
        return DummyResponse()

    monkeypatch.setattr(transit_service, "urlopen", fake_urlopen)

    rows = transit_service._query_tic_rows(348.4947931, 8.7610793, 10.5)

    assert rows == [{"ID": 1, "ra": 1.0, "dec": 2.0, "Tmag": 10.0}]
    assert captured["url"] == "https://mast.stsci.edu/api/v0/invoke"
    assert captured["accept"] == "text/plain"

    encoded_payload = captured["data"].removeprefix("request=")
    payload = __import__("json").loads(unquote(encoded_payload))
    assert payload["service"] == "Mast.Catalogs.Filtered.Tic.Position.Rows"
    assert payload["params"]["ra"] == 348.4947931
    assert payload["params"]["dec"] == 8.7610793
