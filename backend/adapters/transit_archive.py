"""Transit-target archive backed by curated TESS targets and sector metadata."""

from __future__ import annotations

import json
from functools import lru_cache
import logging
from pathlib import Path
import re
from typing import Any
from urllib.error import URLError
from urllib.parse import quote, urlencode
from urllib.request import urlopen

from astropy.coordinates import SkyCoord
import astropy.units as u

_DATA_DIR = Path(__file__).parent.parent / "dummy_data"
_EXOPLANET_ARCHIVE_TAP_URL = "https://exoplanetarchive.ipac.caltech.edu/TAP/sync"
_TESSCUT_SECTOR_URL = "https://mast.stsci.edu/tesscut/api/v0.1/sector"
_TESSCUT_ASTROCUT_URL = "https://mast.stsci.edu/tesscut/api/v0.1/astrocut"
_DEFAULT_CUTOUT_SIZE_PX = 35
_DEFAULT_MAX_TARGETS = 20
_DEFAULT_MIN_DEPTH_PCT = 1.0
_DEFAULT_MAX_PERIOD_DAYS = 5.0
_DEFAULT_MAX_HOST_VMAG = 13.0

logger = logging.getLogger(__name__)


class TransitArchive:
    """Transit target registry with lightweight TESS sector lookup."""

    def __init__(self) -> None:
        with open(_DATA_DIR / "transit_targets.json", encoding="utf-8") as f:
            self._fallback_targets: list[dict[str, Any]] = json.load(f)
        for target in self._fallback_targets:
            target.setdefault("data_source", "curated_fallback")
        self._targets_by_id: dict[str, dict[str, Any]] = {
            target["id"]: target for target in self._fallback_targets
        }

    def list_targets(
        self,
        topic_id: str | None = None,
        limit: int = _DEFAULT_MAX_TARGETS,
        min_depth_pct: float = _DEFAULT_MIN_DEPTH_PCT,
        max_period_days: float = _DEFAULT_MAX_PERIOD_DAYS,
        max_host_vmag: float = _DEFAULT_MAX_HOST_VMAG,
    ) -> list[dict[str, Any]]:
        if topic_id and topic_id != "exoplanet_transit":
            return []

        try:
            live_targets = _live_target_catalog(
                max(1, min(100, int(limit))),
                max(0.1, float(min_depth_pct)),
                max(0.2, float(max_period_days)),
                max(6.0, float(max_host_vmag)),
            )
        except (OSError, URLError, json.JSONDecodeError) as error:
            logger.warning("Transit target live query failed, using fallback list: %s", error)
            live_targets = []
        if live_targets:
            self._targets_by_id.update({target["id"]: target for target in live_targets})
            return live_targets

        return self._fallback_targets[: max(1, min(len(self._fallback_targets), int(limit)))]

    def get_target(self, target_id: str) -> dict[str, Any] | None:
        target = self._targets_by_id.get(target_id)
        if target:
            return target

        try:
            broad_targets = _live_target_catalog(100, 0.1, 30.0, 16.0)
        except (OSError, URLError, json.JSONDecodeError) as error:
            logger.warning("Transit target broad live query failed: %s", error)
            broad_targets = []
        if broad_targets:
            self._targets_by_id.update({item["id"]: item for item in broad_targets})
        return self._targets_by_id.get(target_id)

    def list_observations(self, target_id: str) -> list[dict[str, Any]]:
        target = self.get_target(target_id)
        if not target:
            return []
        return _sector_observations(
            target_id,
            target["ra"],
            target["dec"],
            json.dumps(target.get("fallback_sectors", []), sort_keys=True),
        )

    def get_observation(
        self, target_id: str, observation_id: str
    ) -> dict[str, Any] | None:
        for observation in self.list_observations(target_id):
            if observation["id"] == observation_id:
                return observation
        return None


def _build_cutout_url(ra: float, dec: float, sector: int) -> str:
    query = urlencode(
        {
            "ra": f"{ra:.6f}",
            "dec": f"{dec:.6f}",
            "x": _DEFAULT_CUTOUT_SIZE_PX,
            "y": _DEFAULT_CUTOUT_SIZE_PX,
            "units": "px",
            "sector": sector,
        }
    )
    return f"{_TESSCUT_ASTROCUT_URL}?{query}"


def _slugify_planet_id(name: str) -> str:
    normalized = re.sub(r"[^a-z0-9]+", "_", name.lower())
    return normalized.strip("_")


def _build_live_target(row: dict[str, Any]) -> dict[str, Any]:
    depth_pct = float(row["pl_trandep"])
    duration_hours = float(row["pl_trandur"]) if row.get("pl_trandur") is not None else None
    host_vmag = float(row["sy_vmag"])
    ra = float(row["ra"])
    dec = float(row["dec"])
    constellation = SkyCoord(ra=ra * u.deg, dec=dec * u.deg).get_constellation()

    description = (
        f"{row['pl_name']} has a transit depth of {depth_pct:.2f}%"
        f" and an orbital period of {float(row['pl_orbper']):.3f} d."
    )
    if duration_hours is not None:
        description += f" Typical transit duration is {duration_hours:.2f} h."

    return {
        "id": _slugify_planet_id(row["pl_name"]),
        "name": row["pl_name"],
        "ra": ra,
        "dec": dec,
        "constellation": constellation,
        "type": "Transit Planet",
        "period_days": float(row["pl_orbper"]),
        "magnitude_range": f"{host_vmag:.2f} V host",
        "description": description,
        "topic_id": "exoplanet_transit",
        "data_source": "nasa_exoplanet_archive",
        "fallback_sectors": [],
    }


@lru_cache(maxsize=32)
def _live_target_catalog(
    limit: int,
    min_depth_pct: float,
    max_period_days: float,
    max_host_vmag: float,
) -> list[dict[str, Any]]:
    query = f"""
        select top {limit}
            pl_name, ra, dec, pl_orbper, sy_vmag, pl_trandep, pl_trandur
        from pscomppars
        where tran_flag = 1
            and sy_tmag is not null
            and ra is not null
            and dec is not null
            and pl_orbper is not null
            and sy_vmag is not null
            and pl_trandep is not null
            and pl_trandep >= {min_depth_pct:.3f}
            and pl_orbper <= {max_period_days:.3f}
            and sy_vmag <= {max_host_vmag:.3f}
        order by pl_trandep desc, sy_vmag asc
    """
    url = f"{_EXOPLANET_ARCHIVE_TAP_URL}?query={quote(query)}&format=json"

    with urlopen(url, timeout=20) as response:
        rows = json.loads(response.read().decode("utf-8"))

    return [_build_live_target(row) for row in rows]


def _fallback_results(serialized_fallback: str) -> list[dict[str, str]]:
    fallback = json.loads(serialized_fallback)
    return [
        {
            "sector": f"{item['sector']:04d}",
            "camera": str(item["camera"]),
            "ccd": str(item["ccd"]),
            "sectorName": f"tess-s{item['sector']:04d}-{item['camera']}-{item['ccd']}",
        }
        for item in fallback
    ]


@lru_cache(maxsize=64)
def _sector_observations(
    target_id: str,
    ra: float,
    dec: float,
    serialized_fallback: str,
) -> list[dict[str, Any]]:
    query = urlencode({"ra": f"{ra:.6f}", "dec": f"{dec:.6f}"})
    url = f"{_TESSCUT_SECTOR_URL}?{query}"

    try:
        with urlopen(url, timeout=8) as response:
            payload = json.loads(response.read().decode("utf-8"))
            results = payload.get("results", [])
    except (OSError, URLError, json.JSONDecodeError):
        results = _fallback_results(serialized_fallback)

    observations: list[dict[str, Any]] = []
    for item in results:
        sector = int(item["sector"])
        camera = int(item["camera"])
        ccd = int(item["ccd"])
        observations.append(
            {
                "id": f"{target_id}_sector_{sector:04d}",
                "target_id": target_id,
                "epoch": "2000-01-01T00:00:00Z",
                "hjd": float(sector),
                "filter_band": "TESS",
                "exposure_sec": 120.0,
                "thumbnail_url": "",
                "airmass": 0.0,
                "mission": "TESS",
                "sector": sector,
                "camera": camera,
                "ccd": ccd,
                "display_label": f"Sector {sector}",
                "display_subtitle": f"Camera {camera} · CCD {ccd}",
                "cutout_url": _build_cutout_url(ra, dec, sector),
            }
        )

    observations.sort(key=lambda item: item["sector"])
    return observations


archive = TransitArchive()
