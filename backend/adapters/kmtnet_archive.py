"""KMTNet microlensing event archive — 40 synthetic events (2016–2023)."""

from __future__ import annotations

import math
import random
from typing import Any

# Approximate HJD for peak of each galactic bulge season (June)
_YEAR_T0: dict[int, float] = {
    2016: 2457600.0,
    2017: 2457950.0,
    2018: 2458300.0,
    2019: 2458650.0,
    2020: 2458998.0,
    2021: 2459363.0,
    2022: 2459728.0,
    2023: 2460093.0,
}

_SITES = {
    "ctio": {"lon_frac": 0.0},
    "saao": {"lon_frac": 0.33},
    "sso":  {"lon_frac": 0.67},
}

# Column layout:
#   (id, year, ra, dec, event_type, t0_offset, u0, tE, mag_base
#    [, planet_dt, planet_dur, planet_depth])
# t0_offset = days from year's season peak
# planet_dt = planet_t0 relative to event t0
_RAW_EVENTS: list[tuple] = [
    # ── 2016 ──
    ("kmt-2016-blg-0104", 2016, 268.8, -30.6, "ML",     12.0, 0.42, 45.0, 18.8),
    ("kmt-2016-blg-0263", 2016, 271.0, -27.9, "ML",     -8.0, 0.28, 38.0, 17.9),
    ("kmt-2016-blg-0747", 2016, 269.5, -29.4, "ML-HM",  25.0, 0.07, 15.0, 19.1),
    ("kmt-2016-blg-1045", 2016, 270.1, -28.8, "ML",     -3.0, 0.35, 55.0, 19.5),
    ("kmt-2016-blg-1397", 2016, 267.4, -31.5, "ML",     18.0, 0.50, 28.0, 18.2),
    # ── 2017 ──
    ("kmt-2017-blg-0165", 2017, 270.5, -29.1, "ML",      5.0, 0.22, 40.0, 19.8),
    ("kmt-2017-blg-0428", 2017, 268.2, -30.2, "ML-HM",  30.0, 0.05, 22.0, 18.7),
    ("kmt-2017-blg-0673", 2017, 271.7, -27.2, "ML",    -15.0, 0.38, 33.0, 20.2),
    ("kmt-2017-blg-0891", 2017, 269.9, -29.7, "ML-P",   20.0, 0.18, 30.0, 18.9,  5.0, 3.0, 1.2),
    ("kmt-2017-blg-1630", 2017, 267.6, -32.1, "ML",     -5.0, 0.45, 62.0, 19.3),
    # ── 2018 ──
    ("kmt-2018-blg-0057", 2018, 270.3, -28.5, "ML",      8.0, 0.15, 20.0, 17.6),
    ("kmt-2018-blg-0321", 2018, 268.7, -31.0, "ML",    -20.0, 0.48, 50.0, 20.4),
    ("kmt-2018-blg-0532", 2018, 271.2, -27.8, "ML-HM", -10.0, 0.08, 18.0, 19.6),
    ("kmt-2018-blg-0799", 2018, 269.0, -30.4, "ML-P",   35.0, 0.25, 35.0, 20.0,  5.5, 2.0, 0.8),
    ("kmt-2018-blg-1248", 2018, 272.1, -26.5, "ML",     -2.0, 0.33, 44.0, 18.4),
    # ── 2019 ──
    ("kmt-2019-blg-0029", 2019, 270.85, -28.42, "ML",   10.0, 0.30, 30.0, 19.2),
    ("kmt-2019-blg-0506", 2019, 270.0,  -29.9,  "ML",  -18.0, 0.40, 37.0, 19.7),
    ("kmt-2019-blg-0814", 2019, 267.9,  -31.2,  "ML-HM", 55.0, 0.06, 25.0, 18.5),
    ("kmt-2019-blg-1191", 2019, 268.12, -31.05, "ML-HM", 40.0, 0.03, 20.0, 19.0),
    ("kmt-2019-blg-2107", 2019, 271.5,  -28.0,  "ML",   30.0, 0.52, 30.0, 20.5),
    # ── 2020 ──
    ("kmt-2020-blg-0002", 2020, 269.3, -30.0, "ML",      2.0, 0.12, 18.0, 16.8),
    ("kmt-2020-blg-0414", 2020, 270.8, -28.3, "ML",    -25.0, 0.44, 60.0, 19.9),
    ("kmt-2020-blg-0745", 2020, 268.4, -31.4, "ML-HM",  15.0, 0.04, 30.0, 18.3),
    ("kmt-2020-blg-1117", 2020, 272.0, -27.1, "ML",     40.0, 0.36, 42.0, 20.1),
    ("kmt-2020-blg-1431", 2020, 269.7, -29.5, "ML-P",  -12.0, 0.22, 28.0, 19.4,  2.5, 1.8, 1.0),
    # ── 2021 ──
    ("kmt-2021-blg-0291", 2021, 270.6, -29.3, "ML",     10.0, 0.26, 52.0, 18.1),
    ("kmt-2021-blg-0543", 2021, 268.1, -30.8, "ML",    -30.0, 0.46, 35.0, 19.2),
    ("kmt-2021-blg-0817", 2021, 271.8, -27.5, "ML-HM",  22.0, 0.09, 16.0, 20.3),
    ("kmt-2021-blg-1234", 2021, 269.2, -30.6, "ML-P",    5.0, 0.16, 40.0, 17.8,  8.0, 4.0, 1.5),
    ("kmt-2021-blg-1789", 2021, 267.5, -32.3, "ML",     -8.0, 0.38, 25.0, 21.0),
    # ── 2022 ──
    ("kmt-2022-blg-0198", 2022, 270.4,  -28.9,  "ML",  -22.0, 0.32, 48.0, 18.6),
    ("kmt-2022-blg-0440", 2022, 271.35, -27.88, "ML-P",  -5.0, 0.20, 25.0, 20.1,  2.5, 2.5, 0.9),
    ("kmt-2022-blg-0853", 2022, 268.6,  -31.7,  "ML-HM", 38.0, 0.02, 35.0, 17.2),
    ("kmt-2022-blg-1560", 2022, 271.1,  -28.2,  "ML",   -5.0, 0.49, 55.0, 20.8),
    # ── 2023 ──
    ("kmt-2023-blg-0071", 2023, 269.8, -29.8, "ML",      5.0, 0.20, 32.0, 19.0),
    ("kmt-2023-blg-0384", 2023, 270.9, -27.6, "ML-HM",  18.0, 0.07, 20.0, 18.2),
    ("kmt-2023-blg-0612", 2023, 268.3, -30.5, "ML",    -10.0, 0.43, 45.0, 20.6),
    ("kmt-2023-blg-0931", 2023, 271.6, -27.0, "ML-P",   28.0, 0.23, 22.0, 19.5,  3.5, 2.5, 0.7),
    ("kmt-2023-blg-1204", 2023, 269.5, -31.1, "ML",     -3.0, 0.37, 58.0, 18.9),
    ("kmt-2023-blg-1587", 2023, 268.9, -30.3, "ML",     45.0, 0.31, 40.0, 17.5),
]


def _a_max(u0: float) -> float:
    u2 = u0 * u0
    return (u2 + 2.0) / (u0 * math.sqrt(u2 + 4.0))


def _mag_peak(mag_base: float, u0: float) -> float:
    return mag_base - 2.5 * math.log10(_a_max(u0))


def _build_description(ev_type: str, u0: float, tE: float,
                        planet_dur: float | None = None) -> str:
    if ev_type == "ML-HM":
        delta = _a_max(u0)
        return (
            f"고증폭 단일 렌즈 이벤트. u₀ ≈ {u0:.3f}, "
            f"피크 증폭 A_max ≈ {delta:.1f}배 ({2.5 * math.log10(delta):.1f} mag). "
            f"tE ≈ {tE:.0f} d. 아인슈타인 링에 근접하며 행성 이상신호 탐색에 민감."
        )
    if ev_type == "ML-P":
        return (
            f"행성 이상신호를 포함한 미시중력렌즈 이벤트. "
            f"u₀ ≈ {u0:.2f}, tE ≈ {tE:.0f} d. "
            f"단일 렌즈 곡선 위에 약 {planet_dur:.1f}일간의 추가 증폭이 겹쳐 "
            f"행성의 신호로 해석됨. 연속 감시망 없이는 포착 불가."
        )
    return (
        f"표준 단일 렌즈 이벤트. u₀ ≈ {u0:.2f}, tE ≈ {tE:.0f} d. "
        f"CTIO·SAAO·SSO 연속 감시로 피크 전후를 완전히 포착."
    )


def _build_events() -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    for row in _RAW_EVENTS:
        event_id, year, ra, dec, ev_type = row[:5]
        t0_offset, u0, tE, mag_base = row[5], row[6], row[7], row[8]
        t0 = _YEAR_T0[year] + t0_offset

        peak = _mag_peak(mag_base, u0)
        mag_range = f"I = {peak:.1f} – {mag_base:.1f}"

        if ev_type == "ML-P":
            planet_dt, planet_dur, planet_depth = row[9], row[10], row[11]
            model: dict[str, Any] = {
                "type": "planetary",
                "t0": t0, "u0": u0, "tE": tE, "mag_base": mag_base,
                "planet_t0": t0 + planet_dt,
                "planet_dur": planet_dur,
                "planet_depth": planet_depth,
            }
            desc = _build_description(ev_type, u0, tE, planet_dur)
        else:
            model = {"type": "single", "t0": t0, "u0": u0, "tE": tE, "mag_base": mag_base}
            desc = _build_description(ev_type, u0, tE)

        events.append({
            "id": event_id,
            "name": event_id.upper(),
            "ra": ra,
            "dec": dec,
            "constellation": "Sagittarius",
            "type": ev_type,
            "period_days": None,
            "magnitude_range": mag_range,
            "description": desc,
            "topic_id": "microlensing",
            "model": model,
        })
    return events


KMT_EVENTS: list[dict[str, Any]] = _build_events()


# ── physics ───────────────────────────────────────────────────────────────────

def _paczynski_amplification(u: float) -> float:
    if u < 1e-6:
        u = 1e-6
    u2 = u * u
    return (u2 + 2.0) / (u * math.sqrt(u2 + 4.0))


def _single_lens_mag(hjd: float, model: dict) -> float:
    tau = (hjd - model["t0"]) / model["tE"]
    u = math.sqrt(model["u0"] ** 2 + tau ** 2)
    return model["mag_base"] - 2.5 * math.log10(_paczynski_amplification(u))


def _planetary_mag(hjd: float, model: dict) -> float:
    base_mag = _single_lens_mag(hjd, model)
    dt = hjd - model["planet_t0"]
    half = model["planet_dur"] / 2.0
    if abs(dt) < half:
        extra = model["planet_depth"] * (1.0 - (dt / half) ** 2)
        base_mag -= extra
    return base_mag


def synthetic_ml_magnitude(target_id: str, hjd: float) -> tuple[float, float]:
    event = next((e for e in KMT_EVENTS if e["id"] == target_id), None)
    if not event:
        return 18.0, 0.05

    model = event["model"]
    mag = _planetary_mag(hjd, model) if model["type"] == "planetary" else _single_lens_mag(hjd, model)

    mag_err = 0.008 * 10 ** ((mag - 16.0) / 5.0)
    mag_err = min(max(mag_err, 0.004), 0.15)
    mag += random.gauss(0, mag_err)
    return round(mag, 4), round(mag_err, 4)


# ── archive class ─────────────────────────────────────────────────────────────

class KmtnetArchive:
    """In-memory KMTNet microlensing event store with synthetic observations."""

    def __init__(self) -> None:
        self._events = KMT_EVENTS
        self._observations: dict[str, list[dict]] = {}
        self._generate_observations()

    def _generate_observations(self) -> None:
        for event in self._events:
            model = event["model"]
            t0 = model["t0"]
            tE = model["tE"]
            obs_list = []
            obs_index = 1

            for site_id, site_info in _SITES.items():
                n_obs = 20
                t_start = t0 - 2.5 * tE
                t_end   = t0 + 2.5 * tE
                t_span  = t_end - t_start

                for i in range(n_obs):
                    frac = (i + 0.5) / n_obs
                    hjd_base = t_start + frac * t_span
                    day_phase = site_info["lon_frac"] + random.uniform(0, 0.28)
                    hjd = hjd_base + day_phase + random.uniform(-0.04, 0.04)

                    obs_list.append({
                        "id": f"{event['id']}_obs_{obs_index:03d}",
                        "target_id": event["id"],
                        "site": site_id,
                        "hjd": round(hjd, 5),
                        "filter_band": "I",
                        "exposure_sec": 120.0,
                        "airmass": round(1.1 + random.uniform(0, 0.7), 3),
                    })
                    obs_index += 1

            obs_list.sort(key=lambda o: o["hjd"])
            self._observations[event["id"]] = obs_list

    def list_targets(self, topic_id: str | None = None) -> list[dict[str, Any]]:
        if topic_id and topic_id != "microlensing":
            return []
        return self._events

    def get_target(self, target_id: str) -> dict[str, Any] | None:
        return next((e for e in self._events if e["id"] == target_id), None)

    def list_observations(self, target_id: str) -> list[dict]:
        return self._observations.get(target_id, [])

    def get_observation(self, obs_id: str) -> dict | None:
        for obs_list in self._observations.values():
            for obs in obs_list:
                if obs["id"] == obs_id:
                    return obs
        return None


archive = KmtnetArchive()
