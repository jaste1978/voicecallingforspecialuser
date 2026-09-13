"""Outbound email via Resend, mirroring the app service's emailer: until
RESEND_API_KEY is set, messages are logged instead of sent."""

import logging
import os

import httpx

logger = logging.getLogger("emailer")

FROM = os.environ.get("EMAIL_FROM", "SunoSathi सुनोसाथी <namaste@sunosathi.com>")


def configured() -> bool:
    return bool(os.environ.get("RESEND_API_KEY"))


async def send(to: str, subject: str, html: str) -> bool:
    if not configured():
        logger.info("email not configured — would send to %s: %s", to, subject)
        return False
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.post(
                "https://api.resend.com/emails",
                headers={"Authorization": f"Bearer {os.environ['RESEND_API_KEY']}"},
                json={"from": FROM, "to": [to], "subject": subject, "html": html},
            )
        if r.status_code not in (200, 201):
            logger.warning("email send failed: %s %s", r.status_code, r.text[:200])
        return r.status_code in (200, 201)
    except Exception:
        logger.exception("email send error")
        return False


def otp_message(code: str) -> tuple[str, str]:
    subject = f"{code} — your SunoSathi ISL code"
    html = f"""
<div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;
            color:#241B12;line-height:1.6">
  <h2 style="color:#C2410C">Your verification code</h2>
  <p>Enter this code on contribute.sunosathi.com ·
     यह code form में लिखिए:</p>
  <p style="font-size:34px;font-weight:800;letter-spacing:6px;
            background:#FFF3E8;border:1px solid #F0D9C0;border-radius:12px;
            padding:14px 16px;text-align:center">{code}</p>
  <p style="color:#8a7460">Valid for 10 minutes. If you did not request it,
     ignore this email.</p>
</div>"""
    return subject, html


def account_approved(name: str) -> tuple[str, str]:
    first = (name or "").split(" ")[0] or "friend"
    subject = "🤟 You're approved — start recording ISL signs"
    html = f"""
<div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;
            color:#241B12;line-height:1.6">
  <h2 style="color:#C2410C">Namaste {first}! You're in 🎉</h2>
  <p>Your contributor account on the <b>SunoSathi open ISL dataset</b> is
     approved. Sign in and record your first signs:</p>
  <p>👉 <a href="https://contribute.sunosathi.com" style="color:#C2410C">
     <b>contribute.sunosathi.com</b></a></p>
  <p>A word appears on screen, you sign it for 3–5 seconds, watch it back,
     and send. Every clip teaches the AI that will show signs to deaf
     users in the SunoSathi app — and the dataset stays open for ISL
     research.</p>
  <p>Questions? Just reply to this email.</p>
  <p style="color:#8a7460">— Tejas, SunoSathi</p>
</div>"""
    return subject, html
