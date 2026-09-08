"""Apple Push Notification service — alert pushes for incoming calls.

Stage 1 of iOS background ringing: the app registers its APNs device
token; when a call rings and the iPhone app is closed, an alert push
("कॉल आ रहा है") opens the app into the ring screen. Stage 2 (CallKit
VoIP push) reuses this token registry and JWT machinery.

Configure on Railway: APNS_KEY_B64 (base64 of the .p8), APNS_KEY_ID,
APNS_TEAM_ID. Until set, sends are logged no-ops — nothing breaks.
"""

import base64
import logging
import os
import time

import httpx

from history import _conn

logger = logging.getLogger("apns")

TOPIC = os.environ.get("APNS_TOPIC", "com.sunosathi.app")
HOST = os.environ.get("APNS_HOST", "https://api.push.apple.com")

_jwt_cache: tuple[float, str] | None = None


def init() -> None:
    with _conn() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS push_tokens (
                token TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                platform TEXT NOT NULL,
                updated_at REAL DEFAULT (unixepoch('now'))
            )
        """)


def configured() -> bool:
    return bool(os.environ.get("APNS_KEY_B64")
                and os.environ.get("APNS_KEY_ID")
                and os.environ.get("APNS_TEAM_ID"))


def register(user_id: int, token: str, platform: str) -> None:
    with _conn() as conn:
        conn.execute(
            "INSERT INTO push_tokens (token, user_id, platform) VALUES (?, ?, ?)"
            " ON CONFLICT(token) DO UPDATE SET user_id = excluded.user_id,"
            " updated_at = unixepoch('now')",
            (token[:200], user_id, platform[:20]),
        )


def tokens_for(user_id: int, platform: str = "ios") -> list[str]:
    with _conn() as conn:
        rows = conn.execute(
            "SELECT token FROM push_tokens WHERE user_id = ? AND platform = ?",
            (user_id, platform)).fetchall()
    return [r["token"] for r in rows]


def _drop(token: str) -> None:
    with _conn() as conn:
        conn.execute("DELETE FROM push_tokens WHERE token = ?", (token,))


def _bearer() -> str:
    """APNs provider JWT, refreshed every ~45 min (Apple wants 20-60)."""
    global _jwt_cache
    now = time.time()
    if _jwt_cache and now - _jwt_cache[0] < 45 * 60:
        return _jwt_cache[1]
    import jwt as pyjwt
    key = base64.b64decode(os.environ["APNS_KEY_B64"]).decode()
    token = pyjwt.encode(
        {"iss": os.environ["APNS_TEAM_ID"], "iat": int(now)},
        key, algorithm="ES256",
        headers={"kid": os.environ["APNS_KEY_ID"]},
    )
    _jwt_cache = (now, token)
    return token


async def ring_push(user_id: int, caller: str) -> int:
    """Time-sensitive alert to every iOS device of this user. Returns the
    number of pushes accepted by APNs."""
    if not configured():
        logger.info("apns not configured — would ring-push user %s", user_id)
        return 0
    tokens = tokens_for(user_id)
    if not tokens:
        return 0
    payload = {
        "aps": {
            "alert": {
                "title": "SunoSathi 📞 कॉल आ रहा है",
                "body": f"{caller} — tap to answer · जवाब देने के लिए tap कीजिए",
            },
            "sound": "default",
            "interruption-level": "time-sensitive",
        },
        "kind": "incoming-call",
    }
    sent = 0
    async with httpx.AsyncClient(http2=True, timeout=10) as client:
        for token in tokens:
            try:
                r = await client.post(
                    f"{HOST}/3/device/{token}",
                    json=payload,
                    headers={
                        "authorization": f"bearer {_bearer()}",
                        "apns-topic": TOPIC,
                        "apns-push-type": "alert",
                        "apns-priority": "10",
                        # a ring is worthless after the 60s window
                        "apns-expiration": str(int(time.time()) + 50),
                    },
                )
                if r.status_code == 200:
                    sent += 1
                elif r.status_code == 410 or "BadDeviceToken" in r.text:
                    _drop(token)  # device gone / app reinstalled
                    logger.info("dropped dead APNs token for user %s", user_id)
                else:
                    logger.warning("apns %s: %s %s", token[:12], r.status_code, r.text[:120])
            except Exception:
                logger.exception("apns send error")
    return sent


init()
