"""Call history persistence (SQLite, stdlib only)."""

import json
import sqlite3
import time
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent / "sunosathi.db"


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
                transcript TEXT
            )
        """)


def save_call(
    call_uuid: str,
    from_number: str,
    to_number: str,
    started_at: float,
    answered_at: float | None,
    reason: str,
    language: str,
    transcript: list[str],
) -> None:
    with _conn() as conn:
        conn.execute(
            "INSERT INTO calls (call_uuid, from_number, to_number, started_at,"
            " answered_at, ended_at, reason, language, transcript)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                call_uuid, from_number, to_number, started_at,
                answered_at, time.time(), reason, language,
                json.dumps(transcript, ensure_ascii=False),
            ),
        )


def list_calls(limit: int = 50) -> list[dict]:
    with _conn() as conn:
        rows = conn.execute(
            "SELECT * FROM calls ORDER BY started_at DESC LIMIT ?", (limit,)
        ).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        d["transcript"] = json.loads(d["transcript"] or "[]")
        d["answered"] = r["answered_at"] is not None
        d["duration_s"] = (
            int(r["ended_at"] - r["answered_at"]) if r["answered_at"] else 0
        )
        out.append(d)
    return out


init()
