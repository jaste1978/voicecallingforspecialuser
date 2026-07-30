"""Call history persistence (SQLite, stdlib only)."""

import json
import os
import sqlite3
import time
from pathlib import Path

# On Railway a volume is mounted and DB_PATH points into it so call
# history survives redeploys; locally it sits next to the code.
DB_PATH = Path(os.environ.get("DB_PATH", Path(__file__).resolve().parent / "sunosathi.db"))


def _conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init() -> None:
    with _conn() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS calls (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                call_uuid TEXT,
                from_number TEXT,
                to_number TEXT,
                started_at REAL,
                answered_at REAL,
                ended_at REAL,
                reason TEXT,
                language TEXT,
                transcript TEXT,
                timeline TEXT,
                direction TEXT DEFAULT 'in'
            )
        """)
        for ddl in (
            "ALTER TABLE calls ADD COLUMN timeline TEXT",
            "ALTER TABLE calls ADD COLUMN direction TEXT DEFAULT 'in'",
            "ALTER TABLE calls ADD COLUMN quality_score INTEGER",
            "ALTER TABLE calls ADD COLUMN batch_transcript TEXT",
            "ALTER TABLE calls ADD COLUMN user_id INTEGER",
        ):
            try:
                conn.execute(ddl)
            except sqlite3.OperationalError:
                pass  # column already exists


def save_call(
    call_uuid: str,
    from_number: str,
    to_number: str,
    started_at: float,
    answered_at: float | None,
    reason: str,
    language: str,
    transcript: list[str],
    timeline: list[dict] | None = None,
    direction: str = "in",
    user_id: int | None = None,
) -> None:
    with _conn() as conn:
        conn.execute(
            "INSERT INTO calls (call_uuid, from_number, to_number, started_at,"
            " answered_at, ended_at, reason, language, transcript, timeline,"
            " direction, user_id)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                call_uuid, from_number, to_number, started_at,
                answered_at, time.time(), reason, language,
                json.dumps(transcript, ensure_ascii=False),
                json.dumps(timeline or [], ensure_ascii=False),
                direction, user_id,
            ),
        )


def get_by_uuid(call_uuid: str) -> dict | None:
    with _conn() as conn:
        row = conn.execute(
            "SELECT * FROM calls WHERE call_uuid = ? ORDER BY id DESC LIMIT 1",
            (call_uuid,),
        ).fetchone()
    if row is None:
        return None
    d = dict(row)
    d["transcript"] = json.loads(d["transcript"] or "[]")
    return d


def assign_orphans(user_id: int) -> None:
    """One-time migration: pre-multi-tenant rows belong to the first admin."""
    with _conn() as conn:
        conn.execute("UPDATE calls SET user_id = ? WHERE user_id IS NULL", (user_id,))
        conn.execute("UPDATE contacts SET user_id = ? WHERE user_id IS NULL", (user_id,))


def update_quality(call_uuid: str, score: int, batch_transcript: str) -> None:
    with _conn() as conn:
        conn.execute(
            "UPDATE calls SET quality_score = ?, batch_transcript = ?"
            " WHERE call_uuid = ?",
            (score, batch_transcript, call_uuid),
        )


def list_calls(limit: int = 50, user_id: int | None = None) -> list[dict]:
    with _conn() as conn:
        if user_id is None:
            rows = conn.execute(
                "SELECT * FROM calls ORDER BY started_at DESC LIMIT ?", (limit,)
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM calls WHERE user_id = ?"
                " ORDER BY started_at DESC LIMIT ?",
                (user_id, limit),
            ).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        d["transcript"] = json.loads(d["transcript"] or "[]")
        d["timeline"] = json.loads(d["timeline"] or "[]")
        d["answered"] = r["answered_at"] is not None
        d["duration_s"] = (
            int(r["ended_at"] - r["answered_at"]) if r["answered_at"] else 0
        )
        out.append(d)
    return out


init()
