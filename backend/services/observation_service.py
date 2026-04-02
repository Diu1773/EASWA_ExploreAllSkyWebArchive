from adapters.dummy_archive import archive as dummy_archive
from adapters.transit_archive import archive as transit_archive
from schemas.observation import Observation, ObservationListResponse


def list_observations(target_id: str) -> ObservationListResponse:
    raw = (
        transit_archive.list_observations(target_id)
        if transit_archive.get_target(target_id)
        else dummy_archive.list_observations(target_id)
    )
    observations = [Observation(**o) for o in raw]
    return ObservationListResponse(target_id=target_id, observations=observations)
