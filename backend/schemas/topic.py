from pydantic import BaseModel


class Topic(BaseModel):
    id: str
    name: str
    description: str
    icon: str
    target_count: int
    preview_image_url: str | None = None
    preview_label: str | None = None


class TopicListResponse(BaseModel):
    topics: list[Topic]
