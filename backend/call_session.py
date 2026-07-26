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
import outbound
import providers
import tts_prompts
from recorder import CallRecorder

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
        # inbound: pending (webhook, no media) -> ringing (stream up) -> active -> ended
        # outbound: dialing (REST fired) -> pending (answered) -> active -> ended
        self.state = "pending"
        self.direction = "in"
        self.request_uuid: Optional[str] = None
        self.stream_id: Optional[str] = None
        self.vobiz_ws: Optional[WebSocket] = None
        self.sarvam: Optional[SarvamSTTSession] = None
        self.language = "auto"
        self.created_at = time.time()
        self.answered_at: Optional[float] = None
        self.transcript: list[str] = []
        self.trace = Tracer()
        self.last_speech_end_ms: Optional[int] = None
        self.recorder = CallRecorder(call_uuid)
        self.trace.event("incoming_call_webhook", caller=from_number)


class CallManager:
    """Single-user MVP: one browser session, one active call at a time."""

    ENDED_TTL_S = 600

    def __init__(self) -> None:
        self.browser_ws: Optional[WebSocket] = None
        self.call: Optional[Call] = None
        self._lock = asyncio.Lock()
        # call UUIDs we already tore down; Vobiz re-hits the Answer URL for a
        # live call whose stream we closed, and that must NOT ring again
        self._ended_uuids: dict[str, float] = {}

    def was_recently_ended(self, call_uuid: str) -> bool:
        now = time.time()
        self._ended_uuids = {
            u: t for u, t in self._ended_uuids.items() if now - t < self.ENDED_TTL_S
        }
        return call_uuid in self._ended_uuids

    # ---------- browser side ----------

    PENDING_TIMEOUT_S = 10

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
        if mtype == "dial":
            await self.start_outbound(
                msg.get("number", ""), msg.get("name", ""), msg.get("language", "auto")
            )
        elif mtype == "accept" and call and call.state == "ringing":
            call.language = msg.get("language", "auto")
            await self._activate(call)
        elif mtype == "decline" and call and call.state == "ringing":
            await self.end_call("declined")
        elif mtype == "end":
            if call and call.state == "dialing" and call.request_uuid:
                await outbound.hangup_call(call.request_uuid)
                await self.end_call("cancelled")
            else:
                await self.end_call("ended by user")
        elif mtype == "prompt" and call and call.state == "active":
            await self._play_prompt(call, msg.get("name", ""))
        elif mtype == "set_language" and call and call.state == "active":
            language = msg.get("language", "auto")
            call.language = language
            if call.sarvam:
                await call.sarvam.close()
            await self._start_stt(call)
            call.trace.event("language_changed", language=language)
            await self._to_browser({"type": "language_set", "language": language})

    async def _play_prompt(self, call: Call, name: str) -> None:
        """Speak a canned TTS phrase (e.g. 'please speak slower') into the call."""
        pcm = await tts_prompts.get_prompt_pcm(name)
        if pcm is None or not (call.vobiz_ws and call.stream_id):
            return
        call.recorder.write("user", pcm)
        call.trace.event("tts_prompt_played", prompt=name, kb=len(pcm) // 1024)
        chunk = 3200
        for i in range(0, len(pcm), chunk):
            payload = base64.b64encode(pcm[i:i + chunk]).decode("ascii")
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
                logger.exception("failed sending prompt audio")
                break

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
            call.recorder.write("user", pcm)
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

    # ---------- outbound ----------

    async def start_outbound(self, number: str, name: str, language: str) -> None:
        if not number.strip():
            await self._to_browser({"type": "error", "message": "No number to call"})
            return
        if not outbound.configured():
            await self._to_browser({
                "type": "error",
                "message": "Outbound calling is not configured yet",
            })
            return
        async with self._lock:
            if self.call and self.call.state != "ended":
                await self._to_browser({"type": "error", "message": "Another call is in progress"})
                return
            self.call = Call("outbound-pending", name or number, number)
        call = self.call
        call.direction = "out"
        call.state = "dialing"
        call.language = language
        call.trace.event("outbound_dialing", to=number)
        await self._to_browser({"type": "dialing", "to": name or number})
        try:
            data = await outbound.place_call(number)
            call.request_uuid = data.get("request_uuid")
        except Exception as exc:
            logger.exception("outbound place_call failed")
            await self.end_call(f"could not place call: {exc}")
            return
        # safety net if no answer/hangup callback ever arrives
        asyncio.get_running_loop().call_later(
            90, lambda: asyncio.ensure_future(self._dial_timeout(call)),
        )

    async def _dial_timeout(self, call: Call) -> None:
        if self.call is call and call.state == "dialing":
            if call.request_uuid:
                await outbound.hangup_call(call.request_uuid)
            await self.end_call("no answer")

    async def outbound_answered(self, call_uuid: str) -> bool:
        """Answer webhook fired for our outbound call: bind the call UUID."""
        call = self.call
        if call and call.direction == "out" and call.state == "dialing":
            call.call_uuid = call_uuid
            call.recorder.call_uuid = call_uuid
            call.state = "pending"  # media stream comes next
            call.trace.event("outbound_answered")
            return True
        return False

    async def outbound_ringing(self) -> None:
        call = self.call
        if call and call.direction == "out" and call.state == "dialing":
            call.trace.event("outbound_ringing")
            await self._to_browser({"type": "outbound_ringing"})

    async def vobiz_hangup_event(self, reason: str) -> None:
        call = self.call
        if call and call.state != "ended":
            await self.end_call(reason or "call ended")

    # ---------- vobiz side ----------

    async def register_pending(self, call_uuid: str, from_number: str, to_number: str) -> None:
        async with self._lock:
            if self.call and self.call.call_uuid == call_uuid:
                # Duplicate webhook for the call we're already handling
                logger.info("duplicate answer webhook for %s — ignoring", call_uuid)
                return
            if self.call and self.call.state != "ended":
                # Busy with another call; MVP handles one at a time
                logger.warning("second call %s while busy — ignoring", call_uuid)
                return
            self.call = Call(call_uuid, from_number, to_number)
        # Do NOT ring yet: wait for the Vobiz media stream so the user can
        # never accept a call with a dead audio path.
        asyncio.get_running_loop().call_later(
            self.PENDING_TIMEOUT_S,
            lambda: asyncio.ensure_future(self._pending_timeout(call_uuid)),
        )

    async def _pending_timeout(self, call_uuid: str) -> None:
        call = self.call
        if call and call.call_uuid == call_uuid and call.state == "pending":
            logger.warning("call %s: media stream never connected", call_uuid)
            await self.end_call("no media stream from Vobiz")

    async def _ring(self, call: Call) -> None:
        call.state = "ringing"
        call.trace.event("ring_browser")
        await self._to_browser({
            "type": "ring", "from": call.from_number, "callId": call.call_uuid,
        })
        asyncio.get_running_loop().call_later(
            RING_TIMEOUT_S,
            lambda: asyncio.ensure_future(self._ring_timeout(call.call_uuid)),
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
        call.vobiz_ws = ws
        call.stream_id = stream_id
        fmt = start.get("mediaFormat", {})
        call.trace.event("vobiz_stream_started", format=str(fmt))
        logger.info("vobiz stream %s started for call %s (%s)", stream_id, call_id, fmt)
        if call.direction == "out" and call.state in ("dialing", "pending"):
            # user initiated this call; no accept step needed
            await self._activate(call)
        elif call.state == "pending":
            await self._ring(call)

    async def vobiz_media(self, payload_b64: str) -> None:
        """Caller audio frame."""
        call = self.call
        if call is None or call.state != "active":
            return  # ignore audio while ringing
        pcm = base64.b64decode(payload_b64)
        call.recorder.write("caller", pcm)
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

    async def _start_stt(self, call: Call) -> None:
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
                    lang=event.get("language_code"),
                )
                call.transcript.append(event["text"])
                await self._to_browser({
                    "type": "transcript",
                    "text": event["text"],
                    "language_code": event.get("language_code"),
                })
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

        provider = providers.get_stt()
        call.sarvam = provider.create_session(call.language, on_stt_event)
        t_connect = time.time()
        await call.sarvam.start()
        call.trace.event(
            "stt_connected",
            provider=provider.name,
            connect_ms=round((time.time() - t_connect) * 1000),
            language=call.language,
        )

    async def _activate(self, call: Call) -> None:
        call.trace.event("user_accepted")
        await self._start_stt(call)
        call.state = "active"
        call.answered_at = time.time()
        await self._to_browser({"type": "call_started", "from": call.from_number})
        logger.info("call %s active (language=%s)", call.call_uuid, call.language)

    async def end_call(self, reason: str) -> None:
        call = self.call
        if call is None or call.state == "ended":
            return
        call.state = "ended"
        self._ended_uuids[call.call_uuid] = time.time()
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
        call.recorder.close()
        try:
            history.save_call(
                call.call_uuid, call.from_number, call.to_number,
                call.created_at, call.answered_at, reason,
                call.language, call.transcript, call.trace.finish(),
                call.direction,
            )
        except Exception:
            logger.exception("failed saving call history")
        await self._to_browser({"type": "call_ended", "reason": reason})
        self.call = None


manager = CallManager()
