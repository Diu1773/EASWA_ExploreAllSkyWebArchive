from fastapi import APIRouter

from schemas.observation import ObservationListResponse
from services import observation_service

router = APIRouter(tags=["observations"])


@router.get(
    "/targets/{target_id}/observations",
    response_model=ObservationListResponse,
)
def list_observations(target_id: str):
    return observation_service.list_observations(target_id)
