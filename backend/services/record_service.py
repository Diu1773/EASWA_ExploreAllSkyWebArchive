from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from db import (
    create_analysis_record,
    export_analysis_record,
    get_analysis_record,
    list_analysis_records,
)
from schemas.record import (
    RecordListItemResponse,
    RecordListResponse,
    RecordQuestion,
    RecordSubmissionRequest,
    RecordSubmissionResponse,
    RecordTemplateResponse,
)

_TEMPLATE_DIR = Path(__file__).resolve().parent.parent / "survey_templates"


def get_template(template_id: str) -> RecordTemplateResponse:
    template_path = _TEMPLATE_DIR / f"{template_id}.json"
    if not template_path.exists():
        raise ValueError("Survey template not found.")
    with template_path.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    return RecordTemplateResponse(**payload)


def submit_record(
    template_id: str,
    request: RecordSubmissionRequest,
    user_id: int | None,
) -> RecordSubmissionResponse:
    template = get_template(template_id)
    if request.workflow != template.workflow:
        raise ValueError("Workflow does not match the survey template.")

    answers = _validate_answers(template.questions, request.answers)
    record = create_analysis_record(
        workflow=request.workflow,
        template_id=template_id,
        user_id=user_id,
        target_id=request.target_id,
        observation_ids=request.observation_ids,
        title=request.title.strip() or f"{request.target_id} analysis record",
        payload={
            "template": {
                "id": template.id,
                "title": template.title,
                "version": template.version,
            },
            "context": request.context,
            "answers": answers,
        },
    )
    export_path = export_analysis_record(record)
    return RecordSubmissionResponse(
        submission_id=record["id"],
        title=record["title"],
        created_at=record["created_at"],
        export_path=str(export_path.relative_to(Path(__file__).resolve().parent.parent)),
    )


def list_records_for_user(user_id: int) -> RecordListResponse:
    records = list_analysis_records(user_id)
    return RecordListResponse(
        records=[
            RecordListItemResponse(
                submission_id=record["id"],
                workflow=record["workflow"],
                template_id=record["template_id"],
                target_id=record["target_id"],
                observation_ids=record["observation_ids"],
                title=record["title"],
                created_at=record["created_at"],
                payload=record["payload"],
            )
            for record in records
        ]
    )


def get_record_for_user(record_id: int, user_id: int) -> RecordListItemResponse:
    record = get_analysis_record(record_id, user_id)
    if not record:
        raise ValueError("Analysis record not found.")
    return RecordListItemResponse(
        submission_id=record["id"],
        workflow=record["workflow"],
        template_id=record["template_id"],
        target_id=record["target_id"],
        observation_ids=record["observation_ids"],
        title=record["title"],
        created_at=record["created_at"],
        payload=record["payload"],
    )


def _validate_answers(
    questions: list[RecordQuestion],
    answers: dict[str, Any],
) -> dict[str, Any]:
    validated: dict[str, Any] = {}

    for question in questions:
        value = answers.get(question.id)
        if value in (None, ""):
            if question.required:
                raise ValueError(f"'{question.label}' is required.")
            continue

        if question.type in {"text", "textarea", "select", "radio"}:
            if not isinstance(value, str):
                raise ValueError(f"'{question.label}' must be text.")
            if question.options:
                allowed = {option.value for option in question.options}
                if value not in allowed:
                    raise ValueError(f"'{question.label}' has an invalid option.")
            validated[question.id] = value.strip()
            continue

        if question.type == "checkbox":
            if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
                raise ValueError(f"'{question.label}' must be a list of options.")
            allowed = {option.value for option in question.options}
            invalid = [item for item in value if item not in allowed]
            if invalid:
                raise ValueError(f"'{question.label}' has an invalid option.")
            validated[question.id] = value
            continue

        if question.type == "number":
            try:
                number = float(value)
            except (TypeError, ValueError) as error:
                raise ValueError(f"'{question.label}' must be numeric.") from error
            if question.min_value is not None and number < question.min_value:
                raise ValueError(f"'{question.label}' is below the minimum value.")
            if question.max_value is not None and number > question.max_value:
                raise ValueError(f"'{question.label}' is above the maximum value.")
            validated[question.id] = number
            continue

    return validated
