"""Per-user Telegram linking for missed-call alerts.

Telegram bots cannot message a user first: the user taps
t.me/sunosathibot?start=<code> (from Settings), Telegram sends our
webhook a /start with that code, and we bind their chat_id to their
SunoSathi account. From then on the bot may message them (missed calls).
"""

import logging
import secrets
import time

from history import _conn

logger = logging.getLogger("telegram_link")

BOT_USERNAME = "sunosathibot"
LINK_TTL_S = 60 * 30


def init() -> None:
    with _conn() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS telegram_chats (
                user_id INTEGER PRIMARY KEY,
                chat_id TEXT NOT NULL,
                linked_at REAL DEFAULT (unixepoch('now'))
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS telegram_link_tokens (
                token TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                created_at REAL DEFAULT (unixepoch('now'))
            )
        """)


def make_link(user_id: int) -> str:
    token = secrets.token_urlsafe(16)[:32]
    with _conn() as conn:
        conn.execute("DELETE FROM telegram_link_tokens WHERE created_at < ?",
                     (time.time() - LINK_TTL_S,))
        conn.execute(
            "INSERT INTO telegram_link_tokens (token, user_id) VALUES (?, ?)",
            (token, user_id))
    return f"https://t.me/{BOT_USERNAME}?start={token}"


def claim(token: str, chat_id: str) -> int | None:
    """Bind chat_id to the user the token was minted for. Returns user_id."""
    with _conn() as conn:
        row = conn.execute(
            "SELECT user_id FROM telegram_link_tokens WHERE token = ?"
            " AND created_at > ?", (token, time.time() - LINK_TTL_S)).fetchone()
        if row is None:
            return None
        conn.execute("DELETE FROM telegram_link_tokens WHERE token = ?", (token,))
        conn.execute(
            "INSERT INTO telegram_chats (user_id, chat_id) VALUES (?, ?)"
            " ON CONFLICT(user_id) DO UPDATE SET chat_id = excluded.chat_id,"
            " linked_at = unixepoch('now')",
            (row["user_id"], str(chat_id)))
    return row["user_id"]


def chat_for(user_id: int) -> str | None:
    with _conn() as conn:
        row = conn.execute(
            "SELECT chat_id FROM telegram_chats WHERE user_id = ?",
            (user_id,)).fetchone()
    return row["chat_id"] if row else None


def unlink(user_id: int) -> None:
    with _conn() as conn:
        conn.execute("DELETE FROM telegram_chats WHERE user_id = ?", (user_id,))


init()
