"""Lightweight SQLite database for user accounts and analysis records."""

from __future__ import annotations

import json
import os
import secrets
import sqlite3
from contextlib import closing
from pathlib import Path
from threading import Lock
from typing import Any

_BACKEND_DIR = Path(__file__).resolve().parent


def _resolve_runtime_path(env_name: str, default_relative_path: str) -> Path:
    raw_value = os.getenv(env_name, "").strip()
    if not raw_value:
        return _BACKEND_DIR / default_relative_path

    path = Path(raw_value).expanduser()
    if path.is_absolute():
        return path
    return (_BACKEND_DIR / path).resolve()


_DB_PATH = _resolve_runtime_path("EASWA_DB_PATH", "easwa.db")
_SUBMISSION_EXPORT_DIR = _resolve_runtime_path("EASWA_EXPORT_DIR", "submissions")

_SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    google_id       TEXT UNIQUE NOT NULL,
    email           TEXT NOT NULL,
    name            TEXT NOT NULL,
    picture         TEXT,
    created_at      TEXT DEFAULT (datetime('now')),
    last_login_at   TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS analysis_records (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    workflow        TEXT NOT NULL,
    template_id     TEXT NOT NULL,
    user_id         INTEGER,
    target_id       TEXT NOT NULL,
    observation_ids TEXT NOT NULL,
    title           TEXT NOT NULL,
    payload_json    TEXT NOT NULL,
    created_at      TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS analysis_drafts (
    draft_id        TEXT PRIMARY KEY,
    workflow        TEXT NOT NULL,
    user_id         INTEGER NOT NULL,
    target_id       TEXT NOT NULL,
    title           TEXT,
    seed_record_id  INTEGER,
    status          TEXT NOT NULL DEFAULT 'active',
    workflow_version INTEGER NOT NULL DEFAULT 1,
    envelope_json   TEXT NOT NULL,
    created_at      TEXT DEFAULT (datetime('now')),
    updated_at      TEXT DEFAULT (datetime('now')),
    last_opened_at  TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(seed_record_id) REFERENCES analysis_records(id) ON DELETE SET NULL
);
"""


def _get_connection() -> sqlite3.Connection:
    _DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(_DB_PATH), check_same_thread=False, timeout=10.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA busy_timeout=5000")
    return conn


_schema_lock = Lock()
_schema_ready = False
_export_lock = Lock()


def _ensure_schema() -> None:
    global _schema_ready
    if _schema_ready:
        return
    with _schema_lock:
        if _schema_ready:
            return
        with closing(_get_connection()) as db:
            db.executescript(_SCHEMA)
            _ensure_analysis_draft_columns(db)
            _ensure_analysis_record_columns(db)
            db.commit()
        _schema_ready = True


def _ensure_analysis_record_columns(db: sqlite3.Connection) -> None:
    columns = {
        str(row["name"])
        for row in db.execute("PRAGMA table_info(analysis_records)").fetchall()
    }
    if not columns:
        return
    if "share_token" not in columns:
        db.execute("ALTER TABLE analysis_records ADD COLUMN share_token TEXT")
        columns.add("share_token")
    if "share_token" in columns:
        db.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_analysis_records_share_token "
            "ON analysis_records (share_token) WHERE share_token IS NOT NULL"
        )


def _ensure_analysis_draft_columns(db: sqlite3.Connection) -> None:
    columns = {
        str(row["name"])
        for row in db.execute("PRAGMA table_info(analysis_drafts)").fetchall()
    }
    if not columns:
        return

    if "status" not in columns:
        db.execute(
            "ALTER TABLE analysis_drafts ADD COLUMN status TEXT NOT NULL DEFAULT 'active'"
        )
    if "workflow_version" not in columns:
        db.execute(
            "ALTER TABLE analysis_drafts ADD COLUMN workflow_version INTEGER NOT NULL DEFAULT 1"
        )
    if "last_opened_at" not in columns:
        db.execute("ALTER TABLE analysis_drafts ADD COLUMN last_opened_at TEXT")
        columns.add("last_opened_at")
    if "last_opened_at" in columns:
        db.execute(
            """
            UPDATE analysis_drafts
            SET last_opened_at = COALESCE(updated_at, created_at, datetime('now'))
            WHERE last_opened_at IS NULL
            """
        )


def get_db() -> sqlite3.Connection:
    _ensure_schema()
    return _get_connection()


def upsert_user(google_id: str, email: str, name: str, picture: str | None) -> dict[str, Any]:
    """Insert or update a user from Google profile. Returns the user row."""
    with closing(get_db()) as db:
        db.execute(
            """
            INSERT INTO users (google_id, email, name, picture)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(google_id) DO UPDATE SET
                email = excluded.email,
                name = excluded.name,
                picture = excluded.picture,
                last_login_at = datetime('now')
            """,
            (google_id, email, name, picture),
        )
        db.commit()
        row = db.execute("SELECT * FROM users WHERE google_id = ?", (google_id,)).fetchone()
        return dict(row)


def get_user_by_id(user_id: int) -> dict[str, Any] | None:
    with closing(get_db()) as db:
        row = db.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        return dict(row) if row else None


def create_analysis_record(
    *,
    workflow: str,
    template_id: str,
    user_id: int | None,
    target_id: str,
    observation_ids: list[str],
    title: str,
    payload: dict[str, Any],
) -> dict[str, Any]:
    payload_json = json.dumps(payload, ensure_ascii=False)
    observation_ids_json = json.dumps(observation_ids, ensure_ascii=False)
    with closing(get_db()) as db:
        cursor = db.execute(
            """
            INSERT INTO analysis_records (
                workflow,
                template_id,
                user_id,
                target_id,
                observation_ids,
                title,
                payload_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                workflow,
                template_id,
                user_id,
                target_id,
                observation_ids_json,
                title,
                payload_json,
            ),
        )
        db.commit()
        row = db.execute(
            "SELECT * FROM analysis_records WHERE id = ?",
            (cursor.lastrowid,),
        ).fetchone()
        record = dict(row)
        record["observation_ids"] = json.loads(record["observation_ids"])
        record["payload"] = json.loads(record.pop("payload_json"))
        return record


def export_analysis_record(record: dict[str, Any]) -> Path:
    _SUBMISSION_EXPORT_DIR.mkdir(parents=True, exist_ok=True)
    export_path = _SUBMISSION_EXPORT_DIR / f"{record['template_id']}_submissions.jsonl"
    with _export_lock:
        with export_path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(record, ensure_ascii=False) + "\n")
    return export_path


def delete_analysis_record(record_id: int, user_id: int) -> bool:
    with closing(get_db()) as db:
        row = db.execute(
            """
            SELECT *
            FROM analysis_records
            WHERE id = ? AND user_id = ?
            """,
            (record_id, user_id),
        ).fetchone()
        if not row:
            return False

        record = dict(row)
        record["observation_ids"] = json.loads(record["observation_ids"])
        record["payload"] = json.loads(record.pop("payload_json"))

        db.execute(
            "DELETE FROM analysis_records WHERE id = ? AND user_id = ?",
            (record_id, user_id),
        )
        db.commit()

    _remove_exported_analysis_record(record)
    return True


def list_analysis_records(user_id: int) -> list[dict[str, Any]]:
    with closing(get_db()) as db:
        rows = db.execute(
            """
            SELECT *
            FROM analysis_records
            WHERE user_id = ?
            ORDER BY datetime(created_at) DESC, id DESC
            """,
            (user_id,),
        ).fetchall()

        records: list[dict[str, Any]] = []
        for row in rows:
            record = dict(row)
            record["observation_ids"] = json.loads(record["observation_ids"])
            record["payload"] = json.loads(record.pop("payload_json"))
            records.append(record)
        return records


def get_analysis_record(record_id: int, user_id: int) -> dict[str, Any] | None:
    with closing(get_db()) as db:
        row = db.execute(
            """
            SELECT *
            FROM analysis_records
            WHERE id = ? AND user_id = ?
            """,
            (record_id, user_id),
        ).fetchone()
        if not row:
            return None
        return _parse_record_row(row)


def _parse_record_row(row: sqlite3.Row) -> dict[str, Any]:
    record = dict(row)
    record["observation_ids"] = json.loads(record["observation_ids"])
    record["payload"] = json.loads(record.pop("payload_json"))
    return record


def create_or_get_share_token(record_id: int, user_id: int) -> str | None:
    """Create (or return existing) share token for a record owned by user_id."""
    with closing(get_db()) as db:
        row = db.execute(
            "SELECT share_token FROM analysis_records WHERE id = ? AND user_id = ?",
            (record_id, user_id),
        ).fetchone()
        if not row:
            return None
        token = row["share_token"]
        if not token:
            token = secrets.token_urlsafe(16)
            db.execute(
                "UPDATE analysis_records SET share_token = ? WHERE id = ? AND user_id = ?",
                (token, record_id, user_id),
            )
            db.commit()
        return token


def get_analysis_record_by_token(token: str) -> dict[str, Any] | None:
    """Return a record by its public share token (no auth required)."""
    with closing(get_db()) as db:
        row = db.execute(
            "SELECT * FROM analysis_records WHERE share_token = ?",
            (token,),
        ).fetchone()
        if not row:
            return None
        return _parse_record_row(row)


def get_guide_answer_stats() -> dict[str, Any]:
    """Aggregate guide_answers across all records for admin dashboard."""
    with closing(get_db()) as db:
        rows = db.execute(
            "SELECT payload, created_at, user_id, target_id FROM analysis_records ORDER BY created_at"
        ).fetchall()

    question_stats: dict[str, dict[str, int]] = {}
    total_records = len(rows)
    records_with_guide = 0

    for row in rows:
        payload = json.loads(row["payload"]) if isinstance(row["payload"], str) else (row["payload"] or {})
        guide_answers = payload.get("guide_answers") or {}
        if not guide_answers:
            continue
        records_with_guide += 1
        for qid, answer in guide_answers.items():
            if not answer:
                continue
            if qid not in question_stats:
                question_stats[qid] = {}
            question_stats[qid][answer] = question_stats[qid].get(answer, 0) + 1

    return {
        "total_records": total_records,
        "records_with_guide": records_with_guide,
        "question_stats": question_stats,
    }


def upsert_analysis_draft(
    *,
    draft_id: str,
    workflow: str,
    user_id: int,
    target_id: str,
    title: str | None,
    seed_record_id: int | None,
    status: str,
    workflow_version: int,
    envelope: dict[str, Any],
) -> dict[str, Any]:
    envelope_json = json.dumps(envelope, ensure_ascii=False)
    normalized_title = (title or "").strip() or None
    normalized_status = status.strip() or "active"

    with closing(get_db()) as db:
        existing = db.execute(
            """
            SELECT draft_id, user_id
            FROM analysis_drafts
            WHERE draft_id = ?
            """,
            (draft_id,),
        ).fetchone()
        if existing and int(existing["user_id"]) != user_id:
            raise ValueError("Analysis draft already exists for another user.")

        if existing:
            db.execute(
                """
                UPDATE analysis_drafts
                SET workflow = ?,
                    target_id = ?,
                    title = ?,
                    seed_record_id = ?,
                    status = ?,
                    workflow_version = ?,
                    envelope_json = ?,
                    updated_at = datetime('now')
                WHERE draft_id = ? AND user_id = ?
                """,
                (
                    workflow,
                    target_id,
                    normalized_title,
                    seed_record_id,
                    normalized_status,
                    workflow_version,
                    envelope_json,
                    draft_id,
                    user_id,
                ),
            )
        else:
            db.execute(
                """
                INSERT INTO analysis_drafts (
                    draft_id,
                    workflow,
                    user_id,
                    target_id,
                    title,
                    seed_record_id,
                    status,
                    workflow_version,
                    envelope_json
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    draft_id,
                    workflow,
                    user_id,
                    target_id,
                    normalized_title,
                    seed_record_id,
                    normalized_status,
                    workflow_version,
                    envelope_json,
                ),
            )

        db.commit()
        row = db.execute(
            """
            SELECT *
            FROM analysis_drafts
            WHERE draft_id = ? AND user_id = ?
            """,
            (draft_id, user_id),
        ).fetchone()
        draft = dict(row)
        draft["seed_record_id"] = int(draft["seed_record_id"]) if draft["seed_record_id"] is not None else None
        draft["workflow_version"] = int(draft["workflow_version"])
        draft["envelope"] = json.loads(draft.pop("envelope_json"))
        return draft


def list_analysis_drafts(user_id: int) -> list[dict[str, Any]]:
    with closing(get_db()) as db:
        rows = db.execute(
            """
            SELECT *
            FROM analysis_drafts
            WHERE user_id = ?
            ORDER BY datetime(updated_at) DESC, draft_id DESC
            """,
            (user_id,),
        ).fetchall()

        drafts: list[dict[str, Any]] = []
        for row in rows:
            draft = dict(row)
            draft["seed_record_id"] = (
                int(draft["seed_record_id"]) if draft["seed_record_id"] is not None else None
            )
            draft["workflow_version"] = int(draft["workflow_version"])
            draft["envelope"] = json.loads(draft.pop("envelope_json"))
            drafts.append(draft)
        return drafts


def get_analysis_draft(draft_id: str, user_id: int) -> dict[str, Any] | None:
    with closing(get_db()) as db:
        db.execute(
            """
            UPDATE analysis_drafts
            SET last_opened_at = datetime('now')
            WHERE draft_id = ? AND user_id = ?
            """,
            (draft_id, user_id),
        )
        row = db.execute(
            """
            SELECT *
            FROM analysis_drafts
            WHERE draft_id = ? AND user_id = ?
            """,
            (draft_id, user_id),
        ).fetchone()
        if not row:
            return None
        draft = dict(row)
        draft["seed_record_id"] = int(draft["seed_record_id"]) if draft["seed_record_id"] is not None else None
        draft["workflow_version"] = int(draft["workflow_version"])
        draft["envelope"] = json.loads(draft.pop("envelope_json"))
        db.commit()
        return draft


def delete_analysis_draft(draft_id: str, user_id: int) -> bool:
    with closing(get_db()) as db:
        row = db.execute(
            """
            SELECT draft_id
            FROM analysis_drafts
            WHERE draft_id = ? AND user_id = ?
            """,
            (draft_id, user_id),
        ).fetchone()
        if not row:
            return False
        db.execute(
            """
            DELETE FROM analysis_drafts
            WHERE draft_id = ? AND user_id = ?
            """,
            (draft_id, user_id),
        )
        db.commit()
        return True


def _remove_exported_analysis_record(record: dict[str, Any]) -> None:
    export_path = _SUBMISSION_EXPORT_DIR / f"{record['template_id']}_submissions.jsonl"
    if not export_path.exists():
        return

    with _export_lock:
        kept_lines: list[str] = []
        with export_path.open("r", encoding="utf-8") as handle:
            for line in handle:
                stripped = line.strip()
                if not stripped:
                    continue
                try:
                    payload = json.loads(stripped)
                except json.JSONDecodeError:
                    kept_lines.append(line)
                    continue

                if payload.get("id") == record["id"]:
                    continue
                kept_lines.append(line)

        if kept_lines:
            with export_path.open("w", encoding="utf-8") as handle:
                handle.writelines(kept_lines)
        else:
            export_path.unlink(missing_ok=True)
