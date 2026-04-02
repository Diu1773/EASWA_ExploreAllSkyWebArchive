from fastapi import APIRouter

from schemas.topic import TopicListResponse, Topic

router = APIRouter(tags=["topics"])

CDS_HIPS2FITS = (
    "https://alasky.cds.unistra.fr/hips-image-services/hips2fits"
    "?hips=P/DSS2/color&width=320&height=180&projection=TAN&coordsys=icrs&format=jpg"
)

TOPICS = [
    Topic(
        id="eclipsing_binary",
        name="식현상 탐구 (Eclipsing Binaries)",
        description="식쌍성의 광도곡선을 분석하여 공전 주기와 식 깊이를 탐구합니다.",
        icon="🌑",
        target_count=3,
        preview_label="DSS2 / ALGOL",
        preview_image_url=f"{CDS_HIPS2FITS}&fov=0.35&ra=47.0422&dec=40.9568",
    ),
    Topic(
        id="variable_star",
        name="변광성 탐구 (Variable Stars)",
        description="맥동변광성과 장주기변광성의 밝기 변화를 관측하고 분석합니다.",
        icon="⭐",
        target_count=3,
        preview_label="DSS2 / DELTA CEP",
        preview_image_url=f"{CDS_HIPS2FITS}&fov=0.35&ra=337.2929&dec=58.4153",
    ),
    Topic(
        id="exoplanet_transit",
        name="외계행성 식현상 탐구 (Transit Planets)",
        description="TESS 관측 자료를 바탕으로 외계행성 transit 광도곡선을 탐구합니다.",
        icon="🪐",
        target_count=100,
        preview_label="DSS2 / HD 209458",
        preview_image_url=f"{CDS_HIPS2FITS}&fov=0.25&ra=330.794887&dec=18.884923",
    ),
]


@router.get("/topics", response_model=TopicListResponse)
def list_topics():
    return TopicListResponse(topics=TOPICS)
