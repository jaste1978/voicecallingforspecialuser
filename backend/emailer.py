"""Outbound email via Resend (https://resend.com).

Configure once: create a free Resend account, verify the sunosathi.com
domain (3 DNS records), then set RESEND_API_KEY (and optionally EMAIL_FROM)
on Railway. Until configured, messages are logged instead of sent —
nothing breaks, mirroring telegram_notify.
"""

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


def waitlist_welcome(name: str, os_pref: str = "") -> tuple[str, str]:
    """Subject + HTML for the waitlist auto-reply, with OS-specific
    app-testing steps so signups flow straight into the tester pipeline."""
    first = (name or "").split(" ")[0] or "दोस्त"
    subject = "🧡 SunoSathi — आपका आवेदन मिल गया · we got your request"
    if os_pref == "android":
        app_block = """
  <p style="background:#FFF3E8;border:1px solid #F0D9C0;border-radius:12px;
            padding:14px 16px">
     <b>📱 Android app अभी try कीजिए (testing):</b><br/>
     1️⃣ इस group में "Ask to join" कीजिए:
        <a href="https://groups.google.com/g/sunosathi-testers"
           style="color:#C2410C">sunosathi-testers group</a><br/>
     2️⃣ हम approve करेंगे, फिर <b>इसी Gmail</b> से यह link खोलिए:
        <a href="https://play.google.com/apps/testing/com.sunosathi.app"
           style="color:#C2410C">Become a tester</a><br/>
     3️⃣ "Become a tester" दबाइए और Play Store से app install कीजिए —
        और कम से कम 2 हफ़्ते रखिए 🙏</p>"""
    elif os_pref == "iphone":
        app_block = """
  <p style="background:#FFF3E8;border:1px solid #F0D9C0;border-radius:12px;
            padding:14px 16px">
     <b>🍎 iPhone app अभी try कीजिए (TestFlight):</b><br/>
     1️⃣ App Store से <b>TestFlight</b> app install कीजिए<br/>
     2️⃣ फिर iPhone पर यह link खोलिए:
        <a href="https://testflight.apple.com/join/jhavv6fG"
           style="color:#C2410C">SunoSathi on TestFlight</a><br/>
     3️⃣ Accept → Install — app आपके phone पर आ जाएगा</p>"""
    else:
        app_block = ""
    html = f"""
<div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;
            color:#241B12;line-height:1.6">
  <h2 style="color:#C2410C">Namaste {first}! 🙏</h2>
  <p><b>आपका आवेदन मिल गया।</b> Thank you for asking to join
     <b>SunoSathi (सुनोसाथी)</b> — the app that shows phone calls as live
     written captions for people who cannot hear or hear less.</p>
  {app_block}
  <p>We onboard every user <b>personally</b> so the pilot stays smooth.
     You will hear from us on <b>WhatsApp or email within a day or two</b>
     with your account and a 2-minute setup guide.</p>
  <p>Meanwhile you can see how it works, with pictures:<br/>
     👉 <a href="https://sunosathi.com/guide" style="color:#C2410C">
     sunosathi.com/guide</a></p>
  <p>Questions? Just reply to this email or WhatsApp us at
     <b>+91 98190 95969</b>.</p>
  <p style="color:#8a7460">— Tejas, SunoSathi<br/>
     <i>Your phone number. Their voice, your eyes.</i></p>
</div>"""
    return subject, html
