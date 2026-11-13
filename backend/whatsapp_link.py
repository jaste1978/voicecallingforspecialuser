"""Per-user WhatsApp linking for call alerts.

The user links by sending us a message, never by typing a number: Settings
shows a wa.me link that opens WhatsApp with "LINK <code>" pre-filled, they
tap send, and Meta's webhook delivers it with their verified wa_id. That
one step proves they own the number and is their opt-in, so alerts can
never be pointed at someone else's phone. Sending STOP unlinks.
"""

import logging
import secrets
import time
from urllib.parse import quote

from history import _conn

import whatsapp_notify

logger = logging.getLogger("whatsapp_link")

LINK_TTL_S = 60 * 30
_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no 0/O/1/I look-alikes


def init() -> None:
    with _conn() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS whatsapp_numbers (
                user_id INTEGER PRIMARY KEY,
                wa_id TEXT NOT NULL,
                linked_at REAL DEFAULT (unixepoch('now'))
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS whatsapp_link_tokens (
                token TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                created_at REAL DEFAULT (unixepoch('now'))
            )
        """)


def make_link(user_id: int) -> str:
    """A wa.me link that opens a chat with us, the link message pre-typed."""
    token = "".join(secrets.choice(_ALPHABET) for _ in range(8))
    with _conn() as conn:
        conn.execute("DELETE FROM whatsapp_link_tokens WHERE created_at < ?"
                     " OR user_id = ?", (time.time() - LINK_TTL_S, user_id))
        conn.execute(
            "INSERT INTO whatsapp_link_tokens (token, user_id) VALUES (?, ?)",
            (token, user_id))
    return (f"https://wa.me/{whatsapp_notify.business_number()}"
            f"?text={quote(f'LINK {token}')}")


def claim(token: str, wa_id: str) -> int | None:
    """Bind wa_id to the user the token was minted for. Returns user_id."""
    token = (token or "").strip().upper()
    with _conn() as conn:
        row = conn.execute(
            "SELECT user_id FROM whatsapp_link_tokens WHERE token = ?"
            " AND created_at > ?", (token, time.time() - LINK_TTL_S)).fetchone()
        if row is None:
            return None
        conn.execute("DELETE FROM whatsapp_link_tokens WHERE token = ?", (token,))
        conn.execute(
            "INSERT INTO whatsapp_numbers (user_id, wa_id) VALUES (?, ?)"
            " ON CONFLICT(user_id) DO UPDATE SET wa_id = excluded.wa_id,"
            " linked_at = unixepoch('now')",
            (row["user_id"], str(wa_id)))
    return row["user_id"]


def number_for(user_id: int) -> str | None:
    with _conn() as conn:
        row = conn.execute(
            "SELECT wa_id FROM whatsapp_numbers WHERE user_id = ?",
            (user_id,)).fetchone()
    return row["wa_id"] if row else None


def unlink(user_id: int) -> None:
    with _conn() as conn:
        conn.execute("DELETE FROM whatsapp_numbers WHERE user_id = ?", (user_id,))


def unlink_number(wa_id: str) -> int:
    """STOP from WhatsApp: drop every account bound to this number."""
    with _conn() as conn:
        return conn.execute("DELETE FROM whatsapp_numbers WHERE wa_id = ?",
                            (str(wa_id),)).rowcount


async def alert(user_id: int, kind: str, caller: str) -> bool:
    """Send the `kind` template ('missed' | 'callback') if the user linked."""
    to = number_for(user_id)
    if not to:
        return False
    return await whatsapp_notify.send_template(
        to, whatsapp_notify.template(kind), [caller])


async def handle_inbound(wa_id: str, text: str) -> None:
    """One inbound WhatsApp text: LINK <code>, STOP, or anything else."""
    words = (text or "").strip().split()
    head = words[0].upper() if words else ""
    if head == "LINK" and len(words) >= 2:
        user_id = claim(words[1], wa_id)
        if user_id:
            logger.info("whatsapp linked for user %s", user_id)
            await whatsapp_notify.send_text(
                wa_id, "✅ SunoSathi is linked. Missed-call alerts will "
                "arrive here. Send STOP any time to turn them off.")
        else:
            await whatsapp_notify.send_text(
                wa_id, "That link code has expired. Open SunoSathi → "
                "Settings → WhatsApp alerts and try again.")
    elif head in ("STOP", "UNSUBSCRIBE"):
        if unlink_number(wa_id):
            logger.info("whatsapp unlinked by STOP")
        await whatsapp_notify.send_text(
            wa_id, "WhatsApp alerts are off. You can turn them on again "
            "from SunoSathi → Settings.")
    else:
        await whatsapp_notify.send_text(
            wa_id, "🙏 Namaste! This number only sends SunoSathi call "
            "alerts. To link it, open the app → Settings → WhatsApp alerts. "
            "For help: namaste@sunosathi.com")


init()
