"""Lightweight SQLite database for user accounts and analysis records."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any

_DB_PATH = Path(__file__).resolve().parent / "easwa.db"
_SUBMISSION_EXPORT_DIR = Path(__file__).resolve().parent / "submissions"

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
"""


def _get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(str(_DB_PATH), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


_conn: sqlite3.Connection | None = None


def get_db() -> sqlite3.Connection:
    global _conn
    if _conn is None:
        _conn = _get_connection()
        _conn.executescript(_SCHEMA)
    return _conn


def upsert_user(google_id: str, email: str, name: str, picture: str | None) -> dict[str, Any]:
    """Insert or update a user from Google profile. Returns the user row."""
    db = get_db()
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
    row = get_db().execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
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
    db = get_db()
    payload_json = json.dumps(payload, ensure_ascii=False)
    observation_ids_json = json.dumps(observation_ids, ensure_ascii=False)
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
    with export_path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(record, ensure_ascii=False) + "\n")
    return export_path


def list_analysis_records(user_id: int) -> list[dict[str, Any]]:
    rows = get_db().execute(
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
    row = get_db().execute(
        """
        SELECT *
        FROM analysis_records
        WHERE id = ? AND user_id = ?
        """,
        (record_id, user_id),
    ).fetchone()
    if not row:
        return None
    record = dict(row)
    record["observation_ids"] = json.loads(record["observation_ids"])
    record["payload"] = json.loads(record.pop("payload_json"))
    return record
