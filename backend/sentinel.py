"""The company's night watchman and morning clerk — server-side, always on.

Deterministic company operations that need no human and no LLM:

- Night watch (03:30 IST): stages a full synthetic call against this very
  server — webhook -> ring -> accept -> real TTS caller audio -> live
  captions -> hangup — on a dedicated internal user line (nobody's phone
  rings). Telegram alert ONLY on failure.
- Morning brief (08:00 IST): yesterday's calls, quality, failures and
  spend in one Telegram message.
- Failure-streak monitor (every 10 min): 3+ consecutive failed real calls
  within the last hour -> immediate alert.
"""

import asyncio
import base64
import json
import logging
import os
import time
from datetime import datetime, timedelta, timezone

import httpx
import websockets

import auth
import costs as costs_mod
import history
import number_map
import telegram_notify

logger = logging.getLogger("sentinel")

IST = timezone(timedelta(hours=5, minutes=30))
SENTINEL_EMAIL = "sentinel@internal.sunosathi"
SENTINEL_FWD = "0000000001"   # fake forwarded number that maps to the sentinel line
SENTINEL_CALLER = "0000000002"
NIGHT_WATCH_IST = (3, 30)
BRIEF_IST = (8, 0)


def _base() -> str:
    return f"http://127.0.0.1:{os.environ.get('PORT', '8000')}"


def ensure_sentinel_user() -> int:
    """Internal user whose line receives synthetic test calls."""
    with history._conn() as conn:
        row = conn.execute(
            "SELECT id FROM users WHERE email = ?", (SENTINEL_EMAIL,)
        ).fetchone()
    if row:
        uid = row["id"]
    else:
        import secrets
        uid = auth.create_user(SENTINEL_EMAIL, secrets.token_hex(16), "Sentinel", "user")
        logger.info("sentinel user created: id=%s", uid)
    if number_map.resolve(SENTINEL_FWD, "") != uid:
        try:
            number_map.add_number(uid, SENTINEL_FWD)
        except Exception:
            pass
    return uid


async def run_night_watch() -> dict:
    """Full self-call. Returns a report dict; ok=True means captions flowed."""
    import speech

    report = {"ok": False, "stage": "start", "captions": 0, "detail": ""}
    uuid = f"sentinel-{int(time.time())}"
    uid = ensure_sentinel_user()
    token = auth.create_session(uid)

    try:
        pcm = await speech.speak_pcm("नमस्ते, यह सुनोसाथी की रात की जाँच है। सब ठीक है क्या?")
        if not pcm:
            report.update(stage="tts", detail="TTS returned no audio")
            return report

        report["stage"] = "webhook"
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.post(f"{_base()}/vobiz/answer", json={
                "CallUUID": uuid, "From": SENTINEL_CALLER,
                "To": "07971442451", "ForwardedFrom": f"+91{SENTINEL_FWD}",
            })
            if r.status_code != 200 or "Stream" not in r.text:
                report["detail"] = f"webhook HTTP {r.status_code}"
                return report

        report["stage"] = "sockets"
        ws_base = _base().replace("http", "ws")
        browser = await websockets.connect(f"{ws_base}/ws/call?token={token}")
        vobiz = await websockets.connect(f"{ws_base}/ws/vobiz")
        await vobiz.send(json.dumps({"event": "start", "start": {
            "streamId": f"st-{uuid}", "callId": uuid,
            "mediaFormat": {"encoding": "audio/x-l16", "sampleRate": 16000}}}))

        report["stage"] = "ring"
        ringing = False
        deadline = time.time() + 10
        while time.time() < deadline:
            raw = await asyncio.wait_for(browser.recv(), timeout=10)
            if isinstance(raw, bytes):
                continue
            if json.loads(raw).get("type") == "ring":
                ringing = True
                break
        if not ringing:
            report["detail"] = "no ring within 10s"
            return report

        report["stage"] = "accept"
        await browser.send(json.dumps({"type": "accept", "language": "auto"}))

        async def drain_vobiz():
            try:
                while True:
                    await vobiz.recv()
            except Exception:
                pass

        drainer = asyncio.get_running_loop().create_task(drain_vobiz())

        report["stage"] = "captions"
        captions: list[str] = []

        async def speak_and_silence():
            frame = 640
            for i in range(0, len(pcm), frame):
                await vobiz.send(json.dumps({"event": "media", "media": {
                    "payload": base64.b64encode(pcm[i:i + frame]).decode()}}))
                await asyncio.sleep(0.02)
            for _ in range(150):  # 3s silence so VAD finalizes
                await vobiz.send(json.dumps({"event": "media", "media": {
                    "payload": base64.b64encode(b"\x00" * frame).decode()}}))
                await asyncio.sleep(0.02)

        speaker = asyncio.get_running_loop().create_task(speak_and_silence())
        deadline = time.time() + 30
        while time.time() < deadline and not captions:
            try:
                raw = await asyncio.wait_for(browser.recv(), timeout=max(1, deadline - time.time()))
            except asyncio.TimeoutError:
                break
            if isinstance(raw, bytes):
                continue
            msg = json.loads(raw)
            if msg.get("type") == "transcript" and msg.get("text"):
                captions.append(msg["text"])
        speaker.cancel()
        drainer.cancel()

        await browser.send(json.dumps({"type": "end"}))
        await asyncio.sleep(0.5)
        await browser.close()
        await vobiz.close()

        report["captions"] = len(captions)
        if captions:
            report.update(ok=True, stage="done", detail=" | ".join(captions)[:200])
        else:
            report["detail"] = "call ran but no captions arrived"
        return report
    except Exception as exc:
        report["detail"] = f"{type(exc).__name__}: {exc}"
        return report
    finally:
        # keep company stats clean: sentinel calls don't belong in history
        try:
            with history._conn() as conn:
                conn.execute("DELETE FROM calls WHERE call_uuid = ?", (uuid,))
        except Exception:
            pass


async def night_watch_job() -> None:
    report = await run_night_watch()
    if report["ok"]:
        logger.info("night watch GREEN: %s", report["detail"])
    else:
        await telegram_notify.send(
            "🔴 <b>SunoSathi night watch FAILED</b>\n"
            f"Stage: {report['stage']}\n{report['detail']}\n"
            "The call pipeline may be broken — check the Call Monitor."
        )


def _yesterday_stats(uid_exclude: int) -> dict:
    now = time.time()
    since = now - 86400
    calls = [c for c in history.list_calls(300)
             if c["started_at"] >= since and c.get("user_id") != uid_exclude]
    answered = [c for c in calls if c["answered"]]
    failed = [c for c in calls if not c["answered"]]
    scores = [c["quality_score"] for c in answered if c.get("quality_score") is not None]
    minutes = sum(c["duration_s"] for c in answered) / 60
    rates = costs_mod.get_rates()
    spend = sum(costs_mod.call_cost(c, rates)["total"] for c in calls)
    reasons: dict[str, int] = {}
    for c in failed:
        reasons[c.get("reason") or "?"] = reasons.get(c.get("reason") or "?", 0) + 1
    return {
        "total": len(calls), "answered": len(answered), "failed": len(failed),
        "minutes": round(minutes, 1),
        "avg_quality": round(sum(scores) / len(scores)) if scores else None,
        "spend": round(spend, 2), "reasons": reasons,
    }


async def brief_job() -> None:
    uid = ensure_sentinel_user()
    s = _yesterday_stats(uid)
    lines = [
        "☀️ <b>SunoSathi — daily brief</b>",
        f"Calls: {s['total']} · answered {s['answered']} · missed/failed {s['failed']}",
        f"Talk time: {s['minutes']} min · spend ≈ ₹{s['spend']}",
    ]
    if s["avg_quality"] is not None:
        lines.append(f"Caption accuracy: {s['avg_quality']}% avg")
    if s["reasons"]:
        rs = " · ".join(f"{k}: {v}" for k, v in s["reasons"].items())
        lines.append(f"Miss reasons: {rs}")
    if s["total"] == 0:
        lines.append("Quiet day — no calls.")
    lines.append("Night watch: green unless you heard otherwise 🌙")
    await telegram_notify.send("\n".join(lines))


_last_streak_alert = 0.0


async def streak_job() -> None:
    """3+ consecutive failed real calls within the last hour -> alert."""
    global _last_streak_alert
    if time.time() - _last_streak_alert < 3600:
        return
    uid = ensure_sentinel_user()
    recent = [c for c in history.list_calls(20)
              if c["started_at"] >= time.time() - 3600 and c.get("user_id") != uid]
    streak = 0
    for c in recent:  # newest first
        if not c["answered"] and c.get("reason") not in ("declined", "ended by user"):
            streak += 1
        else:
            break
    if streak >= 3:
        _last_streak_alert = time.time()
        await telegram_notify.send(
            f"🚨 <b>{streak} consecutive failed calls in the last hour</b>\n"
            f"Latest reason: {recent[0].get('reason')}\n"
            "Users may be unreachable — check the Call Monitor now."
        )


def _next_run(hour: int, minute: int) -> float:
    now = datetime.now(IST)
    target = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if target <= now:
        target += timedelta(days=1)
    return (target - now).total_seconds()


async def scheduler() -> None:
    logger.info("sentinel scheduler up (telegram %s)",
                "configured" if telegram_notify.configured() else "NOT configured")

    async def daily(hour: int, minute: int, job, name: str):
        while True:
            wait = _next_run(hour, minute)
            logger.info("sentinel: %s in %.0f min", name, wait / 60)
            await asyncio.sleep(wait)
            try:
                await job()
            except Exception:
                logger.exception("sentinel job %s failed", name)
            await asyncio.sleep(60)

    async def periodic():
        while True:
            await asyncio.sleep(600)
            try:
                await streak_job()
            except Exception:
                logger.exception("streak job failed")

    await asyncio.gather(
        daily(*NIGHT_WATCH_IST, night_watch_job, "night watch"),
        daily(*BRIEF_IST, brief_job, "morning brief"),
        periodic(),
    )


def start() -> None:
    if os.environ.get("RUN_SENTINEL", "1") == "0":
        logger.info("sentinel disabled (RUN_SENTINEL=0)")
        return
    asyncio.get_running_loop().create_task(scheduler())
