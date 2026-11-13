"""WhatsApp delivery for user alerts (Meta WhatsApp Cloud API).

Configure once on the host (nothing is sent, and the Settings entry stays
hidden, until the first three are set):

  WHATSAPP_TOKEN         permanent system-user access token
  WHATSAPP_PHONE_ID      phone number ID of the SunoSathi business number
  WHATSAPP_NUMBER        that number in digits with country code (wa.me link)
  WHATSAPP_APP_SECRET    Meta app secret — verifies inbound webhook signatures
  WHATSAPP_VERIFY_TOKEN  any string; typed into Meta's webhook setup screen
  WHATSAPP_API_VERSION   Graph API version (default below; Meta retires
                         each version after about two years)

WhatsApp only lets a business start a conversation with a pre-approved
template. Create these two in WhatsApp Manager, category Utility, language
English, each with one body variable:

  missed_call  "You missed a call on SunoSathi from {{1}}. Open the app to
                call back: https://app.sunosathi.com"
  call_back    "{{1}} called you back on SunoSathi. Open the app to return
                the call: https://app.sunosathi.com"

Template names/language can be overridden with WHATSAPP_TPL_MISSED,
WHATSAPP_TPL_CALLBACK and WHATSAPP_TPL_LANG.
"""

import hashlib
import hmac
import logging
import os
import re

import httpx

logger = logging.getLogger("whatsapp")

DEFAULT_API_VERSION = "v25.0"


def configured() -> bool:
    return bool(os.environ.get("WHATSAPP_TOKEN")
                and os.environ.get("WHATSAPP_PHONE_ID")
                and business_number())


def business_number() -> str:
    """Our WhatsApp number, digits only (the form wa.me expects)."""
    return re.sub(r"\D", "", os.environ.get("WHATSAPP_NUMBER", ""))


def template(kind: str) -> str:
    defaults = {"missed": "missed_call", "callback": "call_back"}
    return os.environ.get(f"WHATSAPP_TPL_{kind.upper()}", defaults[kind])


def _clean_param(text: str) -> str:
    """Template variables may not hold newlines, tabs or runs of spaces."""
    return re.sub(r"\s+", " ", str(text or "")).strip()[:200] or "-"


async def _post(payload: dict) -> bool:
    if not configured():
        logger.info("whatsapp not configured — message would be: %s", payload)
        return False
    version = os.environ.get("WHATSAPP_API_VERSION", DEFAULT_API_VERSION)
    url = (f"https://graph.facebook.com/{version}/"
           f"{os.environ['WHATSAPP_PHONE_ID']}/messages")
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.post(
                url,
                headers={"Authorization": f"Bearer {os.environ['WHATSAPP_TOKEN']}"},
                json={"messaging_product": "whatsapp", **payload},
            )
        if r.status_code != 200:
            logger.warning("whatsapp send failed: %s %s", r.status_code, r.text[:300])
        return r.status_code == 200
    except Exception:
        logger.exception("whatsapp send error")
        return False


async def send_template(to: str, name: str, params: list[str]) -> bool:
    """Business-initiated message. `to` is a wa_id (digits, country code)."""
    return await _post({
        "to": to,
        "type": "template",
        "template": {
            "name": name,
            "language": {"code": os.environ.get("WHATSAPP_TPL_LANG", "en")},
            "components": [{
                "type": "body",
                "parameters": [{"type": "text", "text": _clean_param(p)}
                               for p in params],
            }],
        },
    })


async def send_text(to: str, text: str) -> bool:
    """Free-form reply. Only delivered within 24h of the user's last message
    to us, so it is used solely to answer what they just sent."""
    return await _post({"to": to, "type": "text",
                        "text": {"body": text, "preview_url": False}})


def valid_signature(body: bytes, header: str | None) -> bool:
    """Check Meta's X-Hub-Signature-256 over the raw webhook body. Fails
    closed when the app secret is not configured."""
    secret = os.environ.get("WHATSAPP_APP_SECRET", "")
    if not secret or not header or not header.startswith("sha256="):
        return False
    want = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(want, header[len("sha256="):])
