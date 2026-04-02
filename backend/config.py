from __future__ import annotations

import os


def _parse_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _parse_csv(name: str, default: list[str]) -> list[str]:
    raw = os.getenv(name)
    if raw is None:
        return default
    values = [item.strip() for item in raw.split(",")]
    return [item for item in values if item]


def _parse_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


DEBUG = _parse_bool("EASWA_DEBUG", True)

# Google OAuth
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "")
SESSION_SECRET = os.getenv("EASWA_SESSION_SECRET", "easwa-dev-secret-change-me")
BASE_URL = os.getenv("EASWA_BASE_URL", "http://localhost:5895")
CORS_ORIGINS = _parse_csv(
    "EASWA_CORS_ORIGINS",
    [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
        "http://localhost:5895",
        "http://127.0.0.1:5895",
    ],
)

TRANSIT_RATE_LIMIT_WINDOW_SECONDS = _parse_int("EASWA_TRANSIT_RATE_LIMIT_WINDOW_SECONDS", 60)
TRANSIT_PREVIEW_INLINE_LIMIT = _parse_int("EASWA_TRANSIT_PREVIEW_INLINE_LIMIT", 90)
TRANSIT_PREVIEW_JOB_LIMIT = _parse_int("EASWA_TRANSIT_PREVIEW_JOB_LIMIT", 8)
TRANSIT_PHOTOMETRY_LIMIT = _parse_int("EASWA_TRANSIT_PHOTOMETRY_LIMIT", 6)
TRANSIT_PREVIEW_JOB_MAX_ITEMS = _parse_int("EASWA_TRANSIT_PREVIEW_JOB_MAX_ITEMS", 24)
TRANSIT_PREVIEW_JOB_TTL_SECONDS = _parse_int(
    "EASWA_TRANSIT_PREVIEW_JOB_TTL_SECONDS",
    15 * 60,
)
