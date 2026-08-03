"""Telegram delivery for company alerts and briefs.

Configure once: create a bot with @BotFather, then set TELEGRAM_BOT_TOKEN
and TELEGRAM_CHAT_ID on Railway. Until configured, messages are logged
instead of sent (nothing breaks).
"""

import logging
import os

import httpx

logger = logging.getLogger("telegram")


def configured() -> bool:
    return bool(os.environ.get("TELEGRAM_BOT_TOKEN") and os.environ.get("TELEGRAM_CHAT_ID"))


async def send(text: str) -> bool:
    if not configured():
        logger.info("telegram not configured — message would be:\n%s", text)
        return False
    token = os.environ["TELEGRAM_BOT_TOKEN"]
    chat = os.environ["TELEGRAM_CHAT_ID"]
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.post(
                f"https://api.telegram.org/bot{token}/sendMessage",
                json={
                    "chat_id": chat,
                    "text": text,
                    "parse_mode": "HTML",
                    "disable_web_page_preview": True,
                },
            )
        if r.status_code != 200:
            logger.warning("telegram send failed: %s %s", r.status_code, r.text[:200])
        return r.status_code == 200
    except Exception:
        logger.exception("telegram send error")
        return False
