import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BACKEND_DIR = ROOT / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from schemas.record import WorkflowDraftRequest
from services import draft_service


def test_upsert_draft_for_user_returns_saved_draft(monkeypatch):
    captured = {}

    def fake_upsert_analysis_draft(**kwargs):
        captured.update(kwargs)
        return {
            "draft_id": kwargs["draft_id"],
            "workflow": kwargs["workflow"],
            "target_id": kwargs["target_id"],
            "title": kwargs["title"],
            "seed_record_id": kwargs["seed_record_id"],
            "status": kwargs["status"],
            "workflow_version": kwargs["workflow_version"],
            "envelope": kwargs["envelope"],
            "created_at": "2026-04-06 10:00:00",
            "updated_at": "2026-04-06 10:05:00",
            "last_opened_at": "2026-04-06 10:06:00",
        }

    monkeypatch.setattr(draft_service, "upsert_analysis_draft", fake_upsert_analysis_draft)

    response = draft_service.upsert_draft_for_user(
        "draft-123",
        WorkflowDraftRequest(
            workflow="transit_lab",
            target_id="hats_5_b",
            title="HATS-5 draft",
            seed_record_id=9,
            status="active",
            workflow_version=3,
            envelope={"version": 1, "step": "run", "snapshot": {"activeObservationId": "obs"}},
        ),
        user_id=7,
    )

    assert response.draft_id == "draft-123"
    assert response.seed_record_id == 9
    assert response.workflow_version == 3
    assert captured["user_id"] == 7
    assert captured["workflow"] == "transit_lab"
    assert captured["target_id"] == "hats_5_b"
    assert captured["status"] == "active"
    assert captured["envelope"]["step"] == "run"


def test_get_draft_for_user_raises_when_missing(monkeypatch):
    monkeypatch.setattr(draft_service, "get_analysis_draft", lambda draft_id, user_id: None)

    try:
        draft_service.get_draft_for_user("draft-missing", 4)
    except ValueError as error:
        assert str(error) == "Analysis draft not found."
    else:
        raise AssertionError("Expected get_draft_for_user to raise ValueError")


def test_delete_draft_for_user_raises_when_missing(monkeypatch):
    monkeypatch.setattr(draft_service, "delete_analysis_draft", lambda draft_id, user_id: False)

    try:
        draft_service.delete_draft_for_user("draft-missing", 4)
    except ValueError as error:
        assert str(error) == "Analysis draft not found."
    else:
        raise AssertionError("Expected delete_draft_for_user to raise ValueError")
