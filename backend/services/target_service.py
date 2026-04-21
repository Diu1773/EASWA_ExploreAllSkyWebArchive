from adapters.dummy_archive import archive as dummy_archive
from adapters.transit_archive import archive as transit_archive
from adapters.kmtnet_archive import archive as kmtnet_archive
from schemas.target import Target, TargetListResponse, TargetDetailResponse


def list_targets(
    topic_id: str | None = None,
    max_targets: int | None = None,
    min_depth_pct: float | None = None,
    max_period_days: float | None = None,
    max_host_vmag: float | None = None,
) -> TargetListResponse:
    if topic_id == "exoplanet_transit":
        raw = transit_archive.list_targets(
            topic_id,
            limit=max_targets or 20,
            min_depth_pct=min_depth_pct or 1.0,
            max_period_days=max_period_days or 5.0,
            max_host_vmag=max_host_vmag or 13.0,
        )
    elif topic_id == "microlensing":
        raw = kmtnet_archive.list_targets(topic_id)
    elif topic_id:
        raw = dummy_archive.list_targets(topic_id)
    else:
        raw = [
            *dummy_archive.list_targets(),
            *transit_archive.list_targets(),
            *kmtnet_archive.list_targets(),
        ]
    targets = [Target(**t) for t in raw]
    return TargetListResponse(targets=targets)


def get_target(target_id: str) -> TargetDetailResponse | None:
    raw = (
        dummy_archive.get_target(target_id)
        or transit_archive.get_target(target_id)
        or kmtnet_archive.get_target(target_id)
    )
    if not raw:
        return None
    topic = raw["topic_id"]
    if topic == "exoplanet_transit":
        src = transit_archive
    elif topic == "microlensing":
        src = kmtnet_archive
    else:
        src = dummy_archive
    obs = src.list_observations(target_id)
    return TargetDetailResponse(target=Target(**raw), observation_count=len(obs))
