"""In-memory dummy data provider with synthetic light curve generation."""

import json
import math
import random
from pathlib import Path
from typing import Any

_DATA_DIR = Path(__file__).parent.parent / "dummy_data"

# ---------------------------------------------------------------------------
# Light curve models for each target
# ---------------------------------------------------------------------------

LIGHT_CURVE_MODELS: dict[str, dict[str, Any]] = {
    "algol": {
        "type": "EA",
        "period": 2.867315,
        "t0": 2460100.0,
        "mag_base": 2.12,
        "primary_depth": 1.28,
        "secondary_depth": 0.05,
        "primary_width": 0.06,
        "secondary_width": 0.04,
    },
    "beta_lyrae": {
        "type": "EB",
        "period": 12.9414,
        "t0": 2460100.0,
        "mag_base": 3.25,
        "primary_depth": 0.60,
        "secondary_depth": 0.30,
        "primary_width": 0.10,
        "secondary_width": 0.08,
    },
    "w_uma": {
        "type": "EW",
        "period": 0.3336,
        "t0": 2460100.0,
        "mag_base": 7.90,
        "primary_depth": 0.70,
        "secondary_depth": 0.55,
        "primary_width": 0.15,
        "secondary_width": 0.15,
    },
    "delta_cep": {
        "type": "DCEP",
        "period": 5.366341,
        "t0": 2460100.0,
        "mag_base": 3.50,
        "amplitude": 0.90,
    },
    "rr_lyr": {
        "type": "RRAB",
        "period": 0.56684,
        "t0": 2460100.0,
        "mag_base": 7.10,
        "amplitude": 1.00,
    },
    "mira": {
        "type": "M",
        "period": 331.96,
        "t0": 2460100.0,
        "mag_base": 2.00,
        "amplitude": 8.10,
    },
}


def _ea_eclipse(phase: float, model: dict) -> float:
    """Algol-type: flat outside eclipses, sharp dips."""
    pw = model["primary_width"]
    sw = model["secondary_width"]
    # Primary eclipse centered at phase 0
    if phase < pw / 2 or phase > 1 - pw / 2:
        p = phase if phase < 0.5 else phase - 1
        return model["primary_depth"] * (1 - (p / (pw / 2)) ** 2)
    # Secondary eclipse centered at phase 0.5
    if abs(phase - 0.5) < sw / 2:
        p = phase - 0.5
        return model["secondary_depth"] * (1 - (p / (sw / 2)) ** 2)
    return 0.0


def _eb_variation(phase: float, model: dict) -> float:
    """Beta Lyrae-type: continuous ellipsoidal variation."""
    primary = model["primary_depth"] * (0.5 * (1 - math.cos(2 * math.pi * phase)))
    secondary = model["secondary_depth"] * (0.5 * (1 - math.cos(4 * math.pi * phase)))
    return (primary + secondary) * 0.5


def _ew_variation(phase: float, model: dict) -> float:
    """W UMa-type: two nearly equal minima."""
    primary = model["primary_depth"] * math.exp(-((phase % 1.0) ** 2) / (2 * 0.04))
    secondary = model["secondary_depth"] * math.exp(
        -(((phase - 0.5) % 1.0) ** 2) / (2 * 0.04)
    )
    return primary + secondary


def _cepheid_variation(phase: float, model: dict) -> float:
    """Cepheid: rapid rise, slow decline (sawtooth-like)."""
    amp = model["amplitude"]
    # Asymmetric: minimum at phase ~0, rapid rise to max at phase ~0.15
    saw = phase * 2 * math.pi
    return amp * (0.5 - 0.3 * math.sin(saw) - 0.2 * math.sin(2 * saw))


def _rrab_variation(phase: float, model: dict) -> float:
    """RR Lyrae ab-type: steep rise, gradual decline."""
    amp = model["amplitude"]
    return amp * (0.5 - 0.35 * math.sin(2 * math.pi * phase)
                  - 0.15 * math.sin(4 * math.pi * phase))


def _mira_variation(phase: float, model: dict) -> float:
    """Mira-type: large amplitude, roughly sinusoidal."""
    amp = model["amplitude"]
    return amp * 0.5 * (1 - math.cos(2 * math.pi * phase))


def synthetic_magnitude(
    target_id: str, hjd: float, aperture_radius: float = 5.0
) -> tuple[float, float]:
    """Return (magnitude, error) for a target at a given HJD."""
    model = LIGHT_CURVE_MODELS[target_id]
    phase = ((hjd - model["t0"]) / model["period"]) % 1.0

    mag = model["mag_base"]
    lc_type = model["type"]

    if lc_type == "EA":
        mag += _ea_eclipse(phase, model)
    elif lc_type == "EB":
        mag += _eb_variation(phase, model)
    elif lc_type == "EW":
        mag += _ew_variation(phase, model)
    elif lc_type == "DCEP":
        mag += _cepheid_variation(phase, model)
    elif lc_type == "RRAB":
        mag += _rrab_variation(phase, model)
    elif lc_type == "M":
        mag += _mira_variation(phase, model)

    # Noise inversely related to aperture (pedagogical)
    base_noise = 0.02
    noise_scale = 5.0 / max(aperture_radius, 1.0)
    error = base_noise * noise_scale
    mag += random.gauss(0, error)

    return mag, error


# ---------------------------------------------------------------------------
# DummyArchive: in-memory data store
# ---------------------------------------------------------------------------

class DummyArchive:
    """Loads dummy targets and generates synthetic observations on init."""

    def __init__(self) -> None:
        with open(_DATA_DIR / "targets.json") as f:
            self._targets: list[dict] = json.load(f)

        self._observations: dict[str, list[dict]] = {}
        self._generate_observations()

    def _generate_observations(self) -> None:
        """Generate 18 mock observations per target spread across the phase curve."""
        for target in self._targets:
            tid = target["id"]
            model = LIGHT_CURVE_MODELS.get(tid)
            if not model:
                continue

            period = model["period"]
            t0 = model["t0"]
            obs_list = []

            for i in range(18):
                # Spread across ~3 periods with some randomness
                hjd = t0 + (i / 18) * period * 3 + random.uniform(-0.05, 0.05) * period
                epoch_iso = f"2023-{6 + i // 6:02d}-{1 + (i * 2) % 28:02d}T{4 + i % 12:02d}:00:00Z"

                obs_list.append({
                    "id": f"{tid}_obs_{i + 1:03d}",
                    "target_id": tid,
                    "epoch": epoch_iso,
                    "hjd": round(hjd, 6),
                    "filter_band": "V",
                    "exposure_sec": 60.0,
                    "thumbnail_url": f"/static/{tid}_{i + 1:03d}.png",
                    "airmass": round(1.0 + random.uniform(0, 0.8), 3),
                })

            self._observations[tid] = obs_list

    def list_targets(self, topic_id: str | None = None) -> list[dict]:
        if topic_id:
            return [t for t in self._targets if t["topic_id"] == topic_id]
        return self._targets

    def get_target(self, target_id: str) -> dict | None:
        for t in self._targets:
            if t["id"] == target_id:
                return t
        return None

    def list_observations(self, target_id: str) -> list[dict]:
        return self._observations.get(target_id, [])

    def get_observation(self, obs_id: str) -> dict | None:
        for obs_list in self._observations.values():
            for obs in obs_list:
                if obs["id"] == obs_id:
                    return obs
        return None


# Singleton instance
archive = DummyArchive()
