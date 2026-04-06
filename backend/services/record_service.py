from __future__ import annotations

import csv
import json
from io import StringIO
from pathlib import Path
from typing import Any

from config import (
    RECORD_MAX_ANSWERS_BYTES,
    RECORD_MAX_CONTEXT_BYTES,
    RECORD_MAX_OBSERVATION_IDS,
    RECORD_MAX_TITLE_LENGTH,
)
from db import (
    create_analysis_record,
    delete_analysis_record,
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
from schemas.transit import (
    PixelCoordinate,
    TransitApertureConfig,
    TransitObservationContext,
    TransitPhotometryRequest,
    TransitTargetContext,
)
from services import transit_service

_TEMPLATE_DIR = Path(__file__).resolve().parent.parent / "survey_templates"
_MAX_RESTORED_COMPARISON_SOURCES = 10


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

    if len(request.observation_ids) > RECORD_MAX_OBSERVATION_IDS:
        raise ValueError(
            f"Too many observations selected. Limit is {RECORD_MAX_OBSERVATION_IDS}."
        )

    answers = _validate_answers(template.questions, request.answers)
    context = dict(request.context)
    context.pop("user", None)
    _validate_payload_size("Context", context, RECORD_MAX_CONTEXT_BYTES)
    _validate_payload_size("Answers", answers, RECORD_MAX_ANSWERS_BYTES)

    title = request.title.strip() or f"{request.target_id} analysis record"
    if len(title) > RECORD_MAX_TITLE_LENGTH:
        raise ValueError(
            f"Title is too long. Limit is {RECORD_MAX_TITLE_LENGTH} characters."
        )

    record = create_analysis_record(
        workflow=request.workflow,
        template_id=template_id,
        user_id=user_id,
        target_id=request.target_id,
        observation_ids=request.observation_ids,
        title=title,
        payload={
            "template": {
                "id": template.id,
                "title": template.title,
                "version": template.version,
            },
            "context": context,
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


def delete_record_for_user(record_id: int, user_id: int) -> None:
    deleted = delete_analysis_record(record_id, user_id)
    if not deleted:
        raise ValueError("Analysis record not found.")


def export_transit_record_csv_for_user(record_id: int, user_id: int) -> tuple[str, str]:
    record = get_analysis_record(record_id, user_id)
    if not record:
        raise ValueError("Analysis record not found.")
    if record["workflow"] != "transit_lab":
        raise ValueError("CSV export is only available for transit-lab records.")

    photometry = transit_service.run_transit_photometry(
        _build_transit_photometry_request(record)
    )
    return (
        _build_record_download_filename(record, "lightcurve.csv"),
        _build_transit_record_csv(record, photometry),
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


def _validate_payload_size(label: str, payload: dict[str, Any], max_bytes: int) -> None:
    encoded = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    if len(encoded) > max_bytes:
        raise ValueError(f"{label} is too large. Limit is {max_bytes} bytes.")


def _build_transit_photometry_request(record: dict[str, Any]) -> TransitPhotometryRequest:
    payload = record.get("payload") or {}
    context = payload.get("context") or {}
    observation_id = str(
        context.get("observation_id")
        or (record.get("observation_ids") or [None])[0]
        or ""
    ).strip()
    if not observation_id:
        raise ValueError("Saved record is missing an observation id.")

    target_position = _parse_pixel_coordinate(
        context.get("target_position"),
        label="saved target position",
    )
    comparison_positions = [
        _parse_pixel_coordinate(item, label=f"saved comparison position #{index + 1}")
        for index, item in enumerate(context.get("comparison_positions") or [])
        if isinstance(item, dict)
    ]
    target_aperture = _parse_saved_aperture(
        context.get("target_aperture"),
        label="saved target aperture",
    )
    comparison_apertures = [
        parsed
        for index, item in enumerate(context.get("comparison_apertures") or [])
        if isinstance(item, dict)
        for parsed in [
            _parse_saved_aperture(
                item,
                label=f"saved comparison aperture #{index + 1}",
            )
        ]
        if parsed is not None
    ]

    aperture = context.get("aperture") or {}
    target_context_payload = context.get("target_context")
    observation_context_payload = context.get("observation_context")

    target_context = None
    if isinstance(target_context_payload, dict):
        target_context = TransitTargetContext(
            ra=float(target_context_payload["ra"]),
            dec=float(target_context_payload["dec"]),
            period_days=target_context_payload.get("period_days"),
        )

    observation_context = None
    if isinstance(observation_context_payload, dict):
        observation_context = TransitObservationContext(
            sector=int(observation_context_payload["sector"]),
            camera=observation_context_payload.get("camera"),
            ccd=observation_context_payload.get("ccd"),
        )
    elif context.get("sector") is not None:
        observation_context = TransitObservationContext(
            sector=int(context["sector"]),
            camera=context.get("camera"),
            ccd=context.get("ccd"),
        )

    return TransitPhotometryRequest(
        target_id=str(record["target_id"]),
        observation_id=observation_id,
        cutout_size_px=int(context.get("field_size_px") or 35),
        target_context=target_context,
        observation_context=observation_context,
        target_position=target_position,
        comparison_positions=comparison_positions[:_MAX_RESTORED_COMPARISON_SOURCES],
        aperture_radius=float(aperture.get("apertureRadius", 2.5)),
        inner_annulus=float(aperture.get("innerAnnulus", 4.0)),
        outer_annulus=float(aperture.get("outerAnnulus", 6.0)),
        target_aperture=target_aperture,
        comparison_apertures=comparison_apertures[:_MAX_RESTORED_COMPARISON_SOURCES],
    )


def _parse_pixel_coordinate(data: Any, *, label: str) -> PixelCoordinate:
    if not isinstance(data, dict):
        raise ValueError(f"Saved record is missing {label}.")
    try:
        return PixelCoordinate(
            x=float(data["x"]),
            y=float(data["y"]),
        )
    except (KeyError, TypeError, ValueError) as error:
        raise ValueError(f"Saved record has an invalid {label}.") from error


def _parse_saved_aperture(data: Any, *, label: str) -> TransitApertureConfig | None:
    if data is None:
        return None
    if not isinstance(data, dict):
        raise ValueError(f"Saved record has an invalid {label}.")

    position = _parse_pixel_coordinate(data.get("position"), label=f"{label} position")
    try:
        return TransitApertureConfig(
            position=position,
            aperture_radius=float(data["aperture_radius"]),
            inner_annulus=float(data["inner_annulus"]),
            outer_annulus=float(data["outer_annulus"]),
        )
    except (KeyError, TypeError, ValueError) as error:
        raise ValueError(f"Saved record has an invalid {label}.") from error


def _build_transit_record_csv(record: dict[str, Any], photometry) -> str:
    payload = record.get("payload") or {}
    context = payload.get("context") or {}
    fit_context = context.get("transit_fit") or {}
    period = fit_context.get("period")
    t0 = fit_context.get("t0")

    buffer = StringIO()
    writer = csv.writer(buffer)
    writer.writerow(
        [
            "record_id",
            "target_id",
            "observation_id",
            "sector",
            "btjd",
            "normalized_flux",
            "flux_error",
            "phase",
        ]
    )

    for point in photometry.light_curve.points:
        phase = ""
        if period not in (None, 0, 0.0) and t0 is not None:
            phase = (((point.hjd - float(t0)) / float(period)) % 1.0 + 1.5) % 1.0 - 0.5
            phase = round(float(phase), 6)

        writer.writerow(
            [
                record["id"],
                record["target_id"],
                photometry.observation_id,
                photometry.sector,
                round(float(point.hjd), 6),
                round(float(point.magnitude), 6),
                round(float(point.mag_error), 6),
                phase,
            ]
        )

    return buffer.getvalue()


def _build_record_download_filename(record: dict[str, Any], suffix: str) -> str:
    raw_title = str(record.get("title") or f"record_{record['id']}")
    safe_title = "".join(
        character.lower() if character.isalnum() else "_"
        for character in raw_title
    ).strip("_")
    while "__" in safe_title:
        safe_title = safe_title.replace("__", "_")
    if not safe_title:
        safe_title = f"record_{record['id']}"
    return f"{safe_title}_{suffix}"
