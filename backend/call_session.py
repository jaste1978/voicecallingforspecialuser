"""Bridges one Vobiz phone call <-> the user's browser <-> Sarvam STT.

Flow:
  Vobiz answer webhook  -> register_pending(call_uuid, from, to), browser gets "ring"
  Vobiz /ws/vobiz start -> attach stream to the call
  Browser "accept"      -> Sarvam session starts, audio bridging begins
      caller media  -> Sarvam STT -> {"type":"transcript"} to browser
      caller media  -> binary PCM frames to browser (playback)
      browser mic (binary PCM) -> Vobiz playAudio -> caller hears the user
  Browser "end" / vobiz disconnect / decline -> teardown, "call_ended"
"""

import asyncio
import base64
import json
import logging
import time
from collections import defaultdict
from typing import Optional

from fastapi import WebSocket

import history
from sarvam_relay import SarvamSTTSession

logger = logging.getLogger("call_session")

RING_TIMEOUT_S = 60
AUDIO_STATS_EVERY = 250  # frames (~5s of 20ms telephony frames)


class Tracer:
    """Per-call timeline of the data pipeline, for latency analysis."""

    def __init__(self) -> None:
        self.t0 = time.time()
        self.events: list[dict] = []
        self.counters: dict[str, int] = defaultdict(int)

    def event(self, name: str, **meta) -> None:
        e = {"t_ms": round((time.time() - self.t0) * 1000), "event": name}
        e.update({k: v for k, v in meta.items() if v is not None})
        self.events.append(e)

    def count(self, name: str, n: int = 1) -> int:
        self.counters[name] += n
        return self.counters[name]

    def finish(self) -> list[dict]:
        if self.counters:
            self.event("totals", **dict(self.counters))
        return self.events


class Call:
    def __init__(self, call_uuid: str, from_number: str, to_number: str):
        self.call_uuid = call_uuid
        self.from_number = from_number
        self.to_number = to_number
        self.state = "ringing"  # ringing -> active -> ended
        self.stream_id: Optional[str] = None
        self.vobiz_ws: Optional[WebSocket] = None
        self.sarvam: Optional[SarvamSTTSession] = None
        self.language = "hi"
        self.created_at = time.time()
        self.answered_at: Optional[float] = None
        self.transcript: list[str] = []
        self.trace = Tracer()
        self.last_speech_end_ms: Optional[int] = None
        self.trace.event("incoming_call_webhook", caller=from_number)


class CallManager:
    """Single-user MVP: one browser session, one active call at a time."""

    def __init__(self) -> None:
        self.browser_ws: Optional[WebSocket] = None
        self.call: Optional[Call] = None
        self._lock = asyncio.Lock()

    # ---------- browser side ----------

    async def browser_connected(self, ws: WebSocket) -> None:
        self.browser_ws = ws
        if self.call and self.call.state == "ringing":
            await self._to_browser({
                "type": "ring",
                "from": self.call.from_number,
                "callId": self.call.call_uuid,
            })

    def browser_disconnected(self, ws: WebSocket) -> None:
        if self.browser_ws is ws:
            self.browser_ws = None

    async def _to_browser(self, event: dict) -> None:
        if self.browser_ws is None:
            return
        try:
            await self.browser_ws.send_text(json.dumps(event, ensure_ascii=False))
        except Exception:
            pass

    async def _to_browser_audio(self, pcm: bytes) -> None:
        if self.browser_ws is None:
            return
        try:
            await self.browser_ws.send_bytes(pcm)
        except Exception:
            pass

    async def on_browser_message(self, msg: dict) -> None:
        mtype = msg.get("type")
        call = self.call
        if mtype == "accept" and call and call.state == "ringing":
            call.language = msg.get("language", "hi")
            await self._activate(call)
        elif mtype == "decline" and call and call.state == "ringing":
            await self.end_call("declined")
        elif mtype == "end":
            await self.end_call("ended by user")

    async def on_browser_audio(self, pcm: bytes) -> None:
        """User's mic -> into the phone call."""
        call = self.call
        if call and call.state == "active" and call.vobiz_ws and call.stream_id:
            n = call.trace.count("user_audio_frames")
            call.trace.count("user_audio_bytes", len(pcm))
            if n == 1:
                call.trace.event("first_user_audio_to_caller")
            elif n % AUDIO_STATS_EVERY == 0:
                call.trace.event(
                    "user_audio_stats", frames=n,
                    kb=call.trace.counters["user_audio_bytes"] // 1024,
                )
            payload = base64.b64encode(pcm).decode("ascii")
            try:
                await call.vobiz_ws.send_text(json.dumps({
                    "event": "playAudio",
                    "streamId": call.stream_id,
                    "media": {
                        "contentType": "audio/x-l16",
                        "sampleRate": 16000,
                        "payload": payload,
                    },
                }))
            except Exception:
                logger.exception("failed sending playAudio to vobiz")

    # ---------- vobiz side ----------

    async def register_pending(self, call_uuid: str, from_number: str, to_number: str) -> None:
        async with self._lock:
            if self.call and self.call.state != "ended":
                # Busy with another call; MVP handles one at a time
                logger.warning("second call %s while busy — ignoring", call_uuid)
                return
            self.call = Call(call_uuid, from_number, to_number)
        await self._to_browser({
            "type": "ring", "from": from_number, "callId": call_uuid,
        })
        asyncio.get_running_loop().call_later(
            RING_TIMEOUT_S, lambda: asyncio.ensure_future(self._ring_timeout(call_uuid))
        )

    async def _ring_timeout(self, call_uuid: str) -> None:
        call = self.call
        if call and call.call_uuid == call_uuid and call.state == "ringing":
            await self.end_call("missed")

    async def vobiz_stream_started(self, ws: WebSocket, start: dict) -> None:
        call = self.call
        stream_id = start.get("streamId")
        call_id = start.get("callId")
        if call is None:
            # Stream arrived with no webhook context (e.g. backend restarted)
            self.call = call = Call(call_id or "unknown", "Unknown caller", "")
            await self._to_browser({"type": "ring", "from": "Unknown caller", "callId": call.call_uuid})
        call.vobiz_ws = ws
        call.stream_id = stream_id
        fmt = start.get("mediaFormat", {})
        call.trace.event("vobiz_stream_started", format=str(fmt))
        logger.info("vobiz stream %s started for call %s (%s)", stream_id, call_id, fmt)

    async def vobiz_media(self, payload_b64: str) -> None:
        """Caller audio frame."""
        call = self.call
        if call is None or call.state != "active":
            return  # ignore audio while ringing
        pcm = base64.b64decode(payload_b64)
        n = call.trace.count("caller_audio_frames")
        call.trace.count("caller_audio_bytes", len(pcm))
        if n == 1:
            call.trace.event("first_caller_audio", frame_bytes=len(pcm))
        elif n % AUDIO_STATS_EVERY == 0:
            call.trace.event(
                "caller_audio_stats", frames=n,
                kb=call.trace.counters["caller_audio_bytes"] // 1024,
            )
        if call.sarvam:
            try:
                await call.sarvam.send_pcm(pcm)
            except Exception:
                logger.exception("sarvam send failed")
        await self._to_browser_audio(pcm)

    async def vobiz_disconnected(self, ws: WebSocket) -> None:
        call = self.call
        if call and call.vobiz_ws is ws and call.state != "ended":
            await self.end_call("caller hung up")

    # ---------- lifecycle ----------

    async def _activate(self, call: Call) -> None:
        async def on_stt_event(event: dict) -> None:
            now_ms = round((time.time() - call.trace.t0) * 1000)
            if event["type"] == "transcript":
                # How long after the caller stopped speaking the caption landed;
                # captions produced mid-speech (flush) have no end reference.
                latency = (
                    now_ms - call.last_speech_end_ms
                    if call.last_speech_end_ms is not None
                    else None
                )
                call.trace.event(
                    "caption", chars=len(event["text"]),
                    after_speech_end_ms=latency,
                    mid_speech=latency is None or None,
                )
                call.transcript.append(event["text"])
                await self._to_browser({"type": "transcript", "text": event["text"]})
            elif event["type"] == "vad":
                if event["signal"] == "START_SPEECH":
                    call.last_speech_end_ms = None
                    call.trace.event("caller_speech_start")
                else:
                    call.last_speech_end_ms = now_ms
                    call.trace.event("caller_speech_end")
                await self._to_browser({"type": "vad", "signal": event["signal"]})
            elif event["type"] == "error":
                call.trace.event("stt_error", message=event["message"])
                await self._to_browser({"type": "error", "message": event["message"]})

        call.trace.event("user_accepted")
        call.sarvam = SarvamSTTSession(call.language, on_stt_event)
        t_connect = time.time()
        await call.sarvam.start()
        call.trace.event(
            "sarvam_connected",
            connect_ms=round((time.time() - t_connect) * 1000),
            language=call.language,
        )
        call.state = "active"
        call.answered_at = time.time()
        await self._to_browser({"type": "call_started", "from": call.from_number})
        logger.info("call %s active (language=%s)", call.call_uuid, call.language)

    async def end_call(self, reason: str) -> None:
        call = self.call
        if call is None or call.state == "ended":
            return
        call.state = "ended"
        logger.info("call %s ended: %s", call.call_uuid, reason)
        if call.sarvam:
            await call.sarvam.close()
        if call.vobiz_ws:
            try:
                if call.stream_id:
                    await call.vobiz_ws.send_text(json.dumps({
                        "event": "stop", "streamId": call.stream_id,
                    }))
                await call.vobiz_ws.close()
            except Exception:
                pass
        call.trace.event("call_ended", reason=reason)
        try:
            history.save_call(
                call.call_uuid, call.from_number, call.to_number,
                call.created_at, call.answered_at, reason,
                call.language, call.transcript, call.trace.finish(),
            )
        except Exception:
            logger.exception("failed saving call history")
        await self._to_browser({"type": "call_ended", "reason": reason})
        self.call = None


manager = CallManager()
