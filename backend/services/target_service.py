from adapters.dummy_archive import archive as dummy_archive
from adapters.transit_archive import archive as transit_archive
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
            min_depth_pct=min_depth_pct or 5.0,
            max_period_days=max_period_days or 5.0,
            max_host_vmag=max_host_vmag or 13.0,
        )
    elif topic_id:
        raw = dummy_archive.list_targets(topic_id)
    else:
        raw = [
            *dummy_archive.list_targets(),
            *transit_archive.list_targets(),
        ]
    targets = [Target(**t) for t in raw]
    return TargetListResponse(targets=targets)


def get_target(target_id: str) -> TargetDetailResponse | None:
    raw = dummy_archive.get_target(target_id) or transit_archive.get_target(target_id)
    if not raw:
        return None
    archive = transit_archive if raw["topic_id"] == "exoplanet_transit" else dummy_archive
    obs = archive.list_observations(target_id)
    return TargetDetailResponse(target=Target(**raw), observation_count=len(obs))
