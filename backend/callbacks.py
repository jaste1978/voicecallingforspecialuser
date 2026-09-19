"""Callbacks to the shared Vobiz number.

Every outbound call any user makes shows the shared Vobiz DID as the caller
ID, so when the person they called dials it back, the call lands on the DID
with no forwarded-from info — nothing to say which user it was for. We look
up who most recently called that number from the app, greet the caller, and
notify that user across every channel (Telegram, push, in-app card), since
not everyone uses Telegram.
"""

import logging
import time

from history import _conn

logger = logging.getLogger("callbacks")

MEMORY_S = 3 * 86400  # how far back "who called this number" looks


def init() -> None:
    with _conn() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS callback_alerts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                caller_number TEXT NOT NULL,
                created_at REAL DEFAULT (unixepoch('now')),
                seen INTEGER DEFAULT 0
            )
        """)


def _last10(number: str) -> str:
    d = "".join(c for c in (number or "") if c.isdigit())
    return d[-10:] if len(d) >= 10 else d


def who_called(caller_number: str) -> int | None:
    """Which user most recently called this number from the app within the
    memory window? That's who a callback to the shared number is for."""
    tail = _last10(caller_number)
    if not tail:
        return None
    with _conn() as conn:
        rows = conn.execute(
            "SELECT user_id, to_number FROM calls WHERE direction = 'out'"
            " AND started_at > ? ORDER BY started_at DESC LIMIT 300",
            (time.time() - MEMORY_S,),
        ).fetchall()
    for r in rows:
        if r["user_id"] and _last10(r["to_number"]) == tail:
            return r["user_id"]
    return None


def record(user_id: int, caller_number: str) -> int:
    with _conn() as conn:
        cur = conn.execute(
            "INSERT INTO callback_alerts (user_id, caller_number) VALUES (?, ?)",
            (user_id, _last10(caller_number) or (caller_number or "")[:20]),
        )
        return cur.lastrowid


def list_for(user_id: int, limit: int = 30) -> list[dict]:
    with _conn() as conn:
        rows = conn.execute(
            "SELECT id, caller_number, created_at, seen FROM callback_alerts"
            " WHERE user_id = ? ORDER BY created_at DESC LIMIT ?",
            (user_id, limit),
        ).fetchall()
    return [dict(r) for r in rows]


def unseen_count(user_id: int) -> int:
    with _conn() as conn:
        return conn.execute(
            "SELECT COUNT(*) FROM callback_alerts WHERE user_id = ? AND seen = 0",
            (user_id,),
        ).fetchone()[0]


def mark_seen(user_id: int, alert_id: int | None = None) -> None:
    with _conn() as conn:
        if alert_id:
            conn.execute(
                "UPDATE callback_alerts SET seen = 1 WHERE id = ? AND user_id = ?",
                (alert_id, user_id))
        else:
            conn.execute(
                "UPDATE callback_alerts SET seen = 1 WHERE user_id = ?", (user_id,))


init()
