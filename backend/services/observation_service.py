from concurrent.futures import ThreadPoolExecutor

from adapters.dummy_archive import archive as dummy_archive
from adapters.transit_archive import archive as transit_archive
from schemas.observation import Observation, ObservationListResponse
from services import transit_service

_FRAME_COUNT_LOOKUP_WORKERS = 4


def list_observations(target_id: str) -> ObservationListResponse:
    transit_target = transit_archive.get_target(target_id)
    raw = (
        transit_archive.list_observations(target_id)
        if transit_target
        else dummy_archive.list_observations(target_id)
    )
    if transit_target and raw:
        raw = _enrich_transit_observations(transit_target, raw)
    observations = [Observation(**o) for o in raw]
    return ObservationListResponse(target_id=target_id, observations=observations)


def _enrich_transit_observations(
    target: dict,
    observations: list[dict],
) -> list[dict]:
    enriched = [dict(observation) for observation in observations]
    max_workers = min(_FRAME_COUNT_LOOKUP_WORKERS, len(enriched))
    if max_workers <= 0:
        return enriched

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        frame_counts = list(
            executor.map(
                lambda observation: transit_service.get_observation_frame_count(
                    str(target["id"]),
                    float(target["ra"]),
                    float(target["dec"]),
                    observation,
                ),
                enriched,
            )
        )

    for observation, frame_count in zip(enriched, frame_counts, strict=False):
        observation["frame_count"] = frame_count

    return enriched
