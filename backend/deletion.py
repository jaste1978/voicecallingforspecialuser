"""Account & data deletion: user-requested, with a 12-hour grace window.

A request records `delete_after = now + GRACE`. The user can cancel within the
window; an admin sees pending requests and can expedite or cancel. A background
sweep purges requests whose window has elapsed.

`purge_user()` removes EVERY row and audio file a user owns and is reused by the
admin delete and the self-serve immediate delete, so nothing is ever left
behind (the older inline deletes missed push_tokens, callback_alerts and audio).
"""

import asyncio
import logging
import time

from history import _conn

logger = logging.getLogger("deletion")

GRACE_SECONDS = 12 * 60 * 60  # 12 hours

# Every table that stores rows keyed by a user's id.
_USER_TABLES = ("sessions", "push_tokens", "numbers", "contacts",
                "calls", "callback_alerts")


def init() -> None:
    with _conn() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS deletion_requests (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                email TEXT,
                name TEXT,
                requested_at REAL DEFAULT (unixepoch('now')),
                delete_after REAL NOT NULL,
                status TEXT DEFAULT 'pending'
            )
        """)


def request(user_id: int, email: str = "", name: str = "",
            grace: int = GRACE_SECONDS) -> dict:
    """Create a pending deletion request, superseding any earlier one."""
    now = time.time()
    with _conn() as conn:
        conn.execute("UPDATE deletion_requests SET status = 'superseded'"
                     " WHERE user_id = ? AND status = 'pending'", (user_id,))
        cur = conn.execute(
            "INSERT INTO deletion_requests (user_id, email, name,"
            " requested_at, delete_after, status)"
            " VALUES (?, ?, ?, ?, ?, 'pending')",
            (user_id, email, name, now, now + grace),
        )
        rid = cur.lastrowid
    logger.info("deletion requested for user %s (auto at %s)", user_id, now + grace)
    return {"id": rid, "requested_at": now, "delete_after": now + grace}


def pending_for(user_id: int) -> dict | None:
    with _conn() as conn:
        row = conn.execute(
            "SELECT * FROM deletion_requests WHERE user_id = ?"
            " AND status = 'pending' ORDER BY id DESC LIMIT 1", (user_id,)
        ).fetchone()
    return dict(row) if row else None


def cancel_for(user_id: int) -> bool:
    with _conn() as conn:
        cur = conn.execute(
            "UPDATE deletion_requests SET status = 'cancelled'"
            " WHERE user_id = ? AND status = 'pending'", (user_id,))
    return cur.rowcount > 0


def list_pending() -> list[dict]:
    with _conn() as conn:
        rows = conn.execute(
            "SELECT * FROM deletion_requests WHERE status = 'pending'"
            " ORDER BY delete_after").fetchall()
    return [dict(r) for r in rows]


def get(req_id: int) -> dict | None:
    with _conn() as conn:
        row = conn.execute("SELECT * FROM deletion_requests WHERE id = ?",
                           (req_id,)).fetchone()
    return dict(row) if row else None


def mark(req_id: int, status: str) -> None:
    with _conn() as conn:
        conn.execute("UPDATE deletion_requests SET status = ? WHERE id = ?",
                     (status, req_id))


def due(now: float | None = None) -> list[dict]:
    now = now if now is not None else time.time()
    with _conn() as conn:
        rows = conn.execute(
            "SELECT * FROM deletion_requests WHERE status = 'pending'"
            " AND delete_after <= ?", (now,)).fetchall()
    return [dict(r) for r in rows]


def _user_call_uuids(user_id: int) -> list[str]:
    with _conn() as conn:
        rows = conn.execute(
            "SELECT call_uuid FROM calls WHERE user_id = ?"
            " AND call_uuid IS NOT NULL", (user_id,)).fetchall()
    return [r["call_uuid"] for r in rows]


def _delete_audio(call_uuids: list[str]) -> int:
    try:
        import recorder
    except Exception:
        return 0
    removed = 0
    for uuid in call_uuids:
        for track in ("caller", "user"):
            p = recorder.REC_DIR / f"{uuid}_{track}.wav"
            try:
                if p.is_file():
                    p.unlink()
                    removed += 1
            except Exception:
                pass
    return removed


def purge_calls(user_id: int) -> dict:
    """Delete only a user's call history: calls, transcripts and audio files.
    The account itself is kept."""
    audio = _delete_audio(_user_call_uuids(user_id))
    with _conn() as conn:
        n = conn.execute("DELETE FROM calls WHERE user_id = ?", (user_id,)).rowcount
    logger.info("cleared %s calls + %s audio files for user %s", n, audio, user_id)
    return {"calls": n, "audio_files": audio}


def purge_user(user_id: int, email: str = "") -> dict:
    """Remove EVERYTHING a user owns across every table, plus their call audio
    files. Returns a counts summary (no personal data)."""
    audio = _delete_audio(_user_call_uuids(user_id))
    counts: dict[str, int] = {}
    with _conn() as conn:
        for table in _USER_TABLES:
            try:
                counts[table] = conn.execute(
                    f"DELETE FROM {table} WHERE user_id = ?", (user_id,)).rowcount
            except Exception:
                pass  # table may be absent on older databases
        if email:
            try:
                counts["waitlist"] = conn.execute(
                    "DELETE FROM waitlist WHERE lower(email) = ?",
                    (email.strip().lower(),)).rowcount
            except Exception:
                pass
        conn.execute("UPDATE deletion_requests SET status = 'done'"
                     " WHERE user_id = ? AND status = 'pending'", (user_id,))
        conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
    counts["audio_files"] = audio
    logger.info("purged user %s: %s", user_id, counts)
    return counts


async def sweep_once() -> int:
    """Purge every request whose 12-hour window has elapsed."""
    import telegram_notify

    done = 0
    for req in due():
        try:
            counts = purge_user(req["user_id"], req.get("email") or "")
            mark(req["id"], "done")
            done += 1
            await telegram_notify.send(
                "🗑 <b>Account auto-deleted</b> (12h window elapsed): "
                f"{req.get('name') or '?'} &lt;{req.get('email') or '?'}&gt;"
                f"\n{counts}")
        except Exception:
            logger.exception("failed to purge deletion request %s", req.get("id"))
    return done


async def sweep_loop(interval: int = 900) -> None:
    """Background task: check for due deletions every `interval` seconds."""
    while True:
        try:
            await sweep_once()
        except Exception:
            logger.exception("deletion sweep error")
        await asyncio.sleep(interval)


init()
