from fastapi import APIRouter

from schemas.topic import TopicListResponse, Topic

router = APIRouter(tags=["topics"])

TOPICS = [
    Topic(
        id="eclipsing_binary",
        name="식쌍성 탐구 (Eclipsing Binaries)",
        description="식쌍성의 광도곡선을 분석하여 공전 주기와 식 깊이를 탐구합니다.",
        icon="🌑",
        target_count=3,
        preview_label="ESO / L. Calçada",
        preview_image_url="https://www.eso.org/public/archives/images/screen/eso1311a.jpg",
    ),
    Topic(
        id="variable_star",
        name="변광성 탐구 (Variable Stars)",
        description="맥동변광성과 장주기변광성의 밝기 변화를 관측하고 분석합니다.",
        icon="⭐",
        target_count=3,
        preview_label="NASA / ESA / Hubble Heritage",
        preview_image_url="https://cdn.esahubble.org/archives/images/screen/heic1323a.jpg",
    ),
    Topic(
        id="exoplanet_transit",
        name="외계행성 식현상 탐구 (Transit Planets)",
        description="TESS 관측 자료를 바탕으로 외계행성 transit 광도곡선을 탐구합니다.",
        icon="🪐",
        target_count=100,
        preview_label="ESA / Hubble",
        preview_image_url="https://cdn.esahubble.org/archives/images/screen/heic0612b.jpg",
    ),
]


@router.get("/topics", response_model=TopicListResponse)
def list_topics():
    return TopicListResponse(topics=TOPICS)
