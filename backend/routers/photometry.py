from fastapi import APIRouter

from schemas.photometry import PhotometryRequest, PhotometryResponse
from services import photometry_service

router = APIRouter(tags=["photometry"])


@router.post("/photometry", response_model=PhotometryResponse)
def run_photometry(req: PhotometryRequest):
    return photometry_service.run_photometry(req)
