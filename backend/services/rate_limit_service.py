from __future__ import annotations

import time
from collections import defaultdict, deque
from threading import Lock

from fastapi import HTTPException, Request

from config import (
    TRANSIT_PHOTOMETRY_LIMIT,
    TRANSIT_PREVIEW_INLINE_LIMIT,
    TRANSIT_PREVIEW_JOB_LIMIT,
    TRANSIT_RATE_LIMIT_WINDOW_SECONDS,
)

_rate_limit_lock = Lock()
_rate_limit_events: dict[str, deque[float]] = defaultdict(deque)
_rate_limit_configs = {
    "transit_preview_inline": TRANSIT_PREVIEW_INLINE_LIMIT,
    "transit_preview_job": TRANSIT_PREVIEW_JOB_LIMIT,
    "transit_photometry": TRANSIT_PHOTOMETRY_LIMIT,
}


def enforce_rate_limit(request: Request, scope: str) -> None:
    limit = _rate_limit_configs.get(scope)
    if limit is None or limit <= 0:
        return

    client_host = request.client.host if request.client else "unknown"
    bucket_id = f"{scope}:{client_host}"
    now = time.time()

    with _rate_limit_lock:
        bucket = _rate_limit_events[bucket_id]
        while bucket and now - bucket[0] > TRANSIT_RATE_LIMIT_WINDOW_SECONDS:
            bucket.popleft()

        if len(bucket) >= limit:
            raise HTTPException(
                status_code=429,
                detail=(
                    "Too many transit processing requests. "
                    "Wait a moment and try again."
                ),
                headers={"Retry-After": str(TRANSIT_RATE_LIMIT_WINDOW_SECONDS)},
            )

        bucket.append(now)
