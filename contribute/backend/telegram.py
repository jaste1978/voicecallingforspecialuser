"""Telegram alerts for the contribution platform.

Same bot as the main app; set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID on
this service too. Until then messages are logged and nothing breaks.

Registrations are alerted immediately — someone standing in an NGO office
waiting to be let in is the one case where a daily digest is too slow.
Everything else the brief wants alerted is a digest, and that is M2.
"""

import logging
import os

import httpx

logger = logging.getLogger("contribute.telegram")


def configured() -> bool:
    return bool(os.environ.get("TELEGRAM_BOT_TOKEN") and os.environ.get("TELEGRAM_CHAT_ID"))


async def send(text: str) -> bool:
    if not configured():
        logger.info("telegram not configured — message would be:\n%s", text)
        return False
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.post(
                f"https://api.telegram.org/bot{os.environ['TELEGRAM_BOT_TOKEN']}/sendMessage",
                json={"chat_id": os.environ["TELEGRAM_CHAT_ID"], "text": text,
                      "parse_mode": "HTML", "disable_web_page_preview": True},
            )
        if r.status_code != 200:
            logger.warning("telegram send failed: %s %s", r.status_code, r.text[:200])
        return r.status_code == 200
    except Exception:
        # An alert that fails must never fail the registration it was about.
        logger.exception("telegram send error")
        return False
