import sqlite3
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BACKEND_DIR = ROOT / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import db


def test_ensure_analysis_record_columns_creates_share_token_index_for_existing_column():
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.execute(
        """
        CREATE TABLE analysis_records (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            share_token TEXT
        )
        """
    )

    db._ensure_analysis_record_columns(conn)

    indexes = {
        row["name"]
        for row in conn.execute("PRAGMA index_list(analysis_records)").fetchall()
    }
    assert "idx_analysis_records_share_token" in indexes


def test_ensure_analysis_draft_columns_backfills_null_last_opened_at():
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.execute(
        """
        CREATE TABLE analysis_drafts (
            draft_id TEXT PRIMARY KEY,
            workflow TEXT NOT NULL,
            user_id INTEGER NOT NULL,
            target_id TEXT NOT NULL,
            title TEXT,
            seed_record_id INTEGER,
            status TEXT NOT NULL DEFAULT 'active',
            workflow_version INTEGER NOT NULL DEFAULT 1,
            envelope_json TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now')),
            last_opened_at TEXT
        )
        """
    )
    conn.execute(
        """
        INSERT INTO analysis_drafts (
            draft_id, workflow, user_id, target_id, envelope_json, created_at, updated_at, last_opened_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            "draft-1",
            "transit_lab",
            1,
            "wasp_52_b",
            "{}",
            "2026-04-01 10:00:00",
            "2026-04-01 11:00:00",
            None,
        ),
    )

    db._ensure_analysis_draft_columns(conn)

    row = conn.execute(
        "SELECT last_opened_at FROM analysis_drafts WHERE draft_id = ?",
        ("draft-1",),
    ).fetchone()
    assert row["last_opened_at"] == "2026-04-01 11:00:00"
