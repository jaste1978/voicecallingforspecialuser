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
import os
import struct
import time
from collections import defaultdict, deque
from typing import Optional

from fastapi import WebSocket

import history
import outbound
import providers
import quality
import tts_prompts
from recorder import CallRecorder

logger = logging.getLogger("call_session")

RING_TIMEOUT_S = 60
AUDIO_STATS_EVERY = 250  # frames (~5s of 20ms telephony frames)

# Romanized rescue: if this much loud speech passes with zero captions,
# the language is likely unidentifiable — switch to as-it-sounds Roman output
RESCUE_AFTER_MS = int(os.environ.get("RESCUE_AFTER_MS", "8000"))
LOUDNESS_RMS = 400  # int16 RMS above which a frame counts as speech-ish

# Noise gate: ambient noise reaching the STT makes it hallucinate captions
# in random languages. Only speech-like audio is forwarded; quieter frames
# become silence (the model can't hallucinate from zeros). The user still
# hears, and we still record, the caller's raw audio.
NOISE_GATE = os.environ.get("NOISE_GATE", "1") != "0"
GATE_MIN_LEVEL = int(os.environ.get("GATE_MIN_LEVEL", "350"))   # abs floor
GATE_OPEN_FACTOR = float(os.environ.get("GATE_OPEN_FACTOR", "3.0"))
GATE_ATTACK_FRAMES = 2      # consecutive loud frames before opening
GATE_HANG_MS = 700          # stay open through natural word gaps
GATE_PREROLL_MS = 240       # replay this much audio on open (word onsets)
GATE_MAX_LOUD_MS = 10000    # loud with NO word gap this long = steady noise


def _mean_abs(pcm: bytes) -> int:
    n = len(pcm) // 2
    if n == 0:
        return 0
    samples = struct.unpack(f"<{n}h", pcm[: n * 2])
    return sum(abs(s) for s in samples) // n


class NoiseGate:
    """Adaptive energy squelch for the STT feed."""

    def __init__(self) -> None:
        self.floor = 200.0          # running ambient-noise estimate
        self.is_open = False
        self._attack = 0
        self._hang_ms = 0.0
        self._loud_run_ms = 0.0     # time above threshold with no gap at all
        self._preroll: deque[bytes] = deque()
        self._preroll_ms = 0.0
        self.opens = 0
        self.reclassified = 0       # steady-noise detections

    def process(self, pcm: bytes) -> tuple[bytes, bool]:
        """Returns (audio for the STT, is_speech). Non-speech comes back as
        an equally sized silence frame so stream cadence and VAD end-of-
        speech finalization keep working."""
        level = _mean_abs(pcm)
        frame_ms = (len(pcm) // 2) * 1000 / 16000
        threshold = max(GATE_MIN_LEVEL, self.floor * GATE_OPEN_FACTOR)

        if self.is_open:
            if level >= threshold:
                self._hang_ms = GATE_HANG_MS
                self._loud_run_ms += frame_ms
                if self._loud_run_ms >= GATE_MAX_LOUD_MS:
                    # speech always has word gaps; an unbroken loud run this
                    # long is machinery/TV — learn it as the new floor
                    self.floor = min(2000.0, max(self.floor, level * 0.6))
                    self.is_open = False
                    self._attack = 0
                    self._loud_run_ms = 0.0
                    self.reclassified += 1
                    return b"\x00" * len(pcm), False
            else:
                self._loud_run_ms = 0.0
                self._hang_ms -= frame_ms
                if self._hang_ms <= 0:
                    self.is_open = False
                    self._attack = 0
            return pcm, True  # hangover frames still pass

        # gate closed: keep learning the ambient level from quiet frames
        if level < threshold:
            self.floor = min(2000.0, max(60.0, self.floor * 0.97 + level * 0.03))
            self._attack = 0
            self._push_preroll(pcm, frame_ms)
            return b"\x00" * len(pcm), False

        self._attack += 1
        if self._attack < GATE_ATTACK_FRAMES:
            self._push_preroll(pcm, frame_ms)
            return b"\x00" * len(pcm), False

        # speech confirmed: open and replay the pre-roll so onsets survive
        self.is_open = True
        self.opens += 1
        self._hang_ms = GATE_HANG_MS
        out = b"".join(self._preroll) + pcm
        self._preroll.clear()
        self._preroll_ms = 0.0
        return out, True

    def _push_preroll(self, pcm: bytes, frame_ms: float) -> None:
        self._preroll.append(pcm)
        self._preroll_ms += frame_ms
        while self._preroll_ms > GATE_PREROLL_MS and len(self._preroll) > 1:
            dropped = self._preroll.popleft()
            self._preroll_ms -= (len(dropped) // 2) * 1000 / 16000


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
        self.stt_label = ""
        self.loud_ms = 0        # loud caller audio since the last caption
        self.rescued = False    # already switched to romanized output
        self.gate = NoiseGate() if NOISE_GATE else None
        self.trace.event("incoming_call_webhook", caller=from_number)


class UserLine:
    """One user's phone line: their app screens + at most one active call.
    Rings broadcast only to this user's sockets; other users' lines are
    independent, so different users can be on calls at the same time."""

    def __init__(self, user_id: int, registry: "CallManager") -> None:
        self.user_id = user_id
        self.registry = registry
        # every open app screen of THIS user (phone, desktop tab...)
        self.browser_sockets: set[WebSocket] = set()
        self.call: Optional[Call] = None
        self._lock = asyncio.Lock()

    # ---------- browser side ----------

    PENDING_TIMEOUT_S = 10

    async def browser_connected(self, ws: WebSocket) -> None:
        self.browser_sockets.add(ws)
        # a screen (re)connecting while a call is ringing must ring immediately
        if self.call and self.call.state == "ringing":
            try:
                await ws.send_text(json.dumps({
                    "type": "ring",
                    "from": self.call.from_number,
                    "callId": self.call.call_uuid,
                }, ensure_ascii=False))
            except Exception:
                pass

    def browser_disconnected(self, ws: WebSocket) -> None:
        self.browser_sockets.discard(ws)

    async def _to_browser(self, event: dict) -> None:
        payload = json.dumps(event, ensure_ascii=False)
        for ws in list(self.browser_sockets):
            try:
                await ws.send_text(payload)
            except Exception:
                self.browser_sockets.discard(ws)

    async def _to_browser_audio(self, pcm: bytes) -> None:
        for ws in list(self.browser_sockets):
            try:
                await ws.send_bytes(pcm)
            except Exception:
                self.browser_sockets.discard(ws)

    async def on_browser_message(self, msg: dict) -> None:
        mtype = msg.get("type")
        call = self.call
        if mtype == "ring_ack":
            if call and call.state == "ringing":
                call.trace.event("ring_ack")
        elif mtype == "dial":
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
            await self._to_browser({
                "type": "language_set",
                "language": language,
                "provider": call.stt_label,
            })

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
            self.registry.bind_uuid(call_uuid, self)
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
        self.registry.bind_uuid(call_uuid, self)
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
        call.trace.event("ring_sent", screens=len(self.browser_sockets))
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
            self.registry.bind_uuid(call.call_uuid, self)
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
        if call.gate is not None:
            stt_pcm, speechy = call.gate.process(pcm)
            call.trace.count("gate_speech_ms" if speechy else "gate_noise_ms",
                             (len(pcm) // 2) * 1000 // 16000)
        else:
            stt_pcm, speechy = pcm, True
        await self._rescue_check(call, pcm, speechy)
        n = call.trace.count("caller_audio_frames")
        call.trace.count("caller_audio_bytes", len(pcm))
        if n == 1:
            call.trace.event("first_caller_audio", frame_bytes=len(pcm))
        elif n % AUDIO_STATS_EVERY == 0:
            call.trace.event(
                "caller_audio_stats", frames=n,
                kb=call.trace.counters["caller_audio_bytes"] // 1024,
                gate_opens=call.gate.opens if call.gate else None,
            )
        if call.sarvam:
            try:
                await call.sarvam.send_pcm(stt_pcm)
            except Exception:
                logger.exception("sarvam send failed")
        await self._to_browser_audio(pcm)

    async def _rescue_check(self, call: Call, pcm: bytes, speechy: bool = True) -> None:
        """If plenty of loud speech produced zero captions, the language is
        likely one the model can't identify — switch to romanized output that
        writes the sounds in English letters. Only gate-approved speech counts,
        so ambient noise can no longer trigger the rescue."""
        if call.rescued or call.language == "romanized" or len(pcm) < 4:
            return
        n_samples = len(pcm) // 2
        frame_ms = (n_samples * 1000) // 16000
        if speechy and _mean_abs(pcm) >= LOUDNESS_RMS:
            call.loud_ms += frame_ms
        if call.loud_ms >= RESCUE_AFTER_MS:
            call.rescued = True
            call.language = "romanized"
            call.trace.event("romanized_rescue", after_loud_ms=call.loud_ms)
            logger.info("call %s: no captions after %dms of speech — "
                        "switching to romanized output", call.call_uuid, call.loud_ms)
            if call.sarvam:
                await call.sarvam.close()
            await self._start_stt(call)
            await self._to_browser({
                "type": "language_set",
                "language": "romanized",
                "provider": call.stt_label,
            })

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
                call.loud_ms = 0  # captions are flowing; no rescue needed
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

        provider = providers.get_stt(call.language)
        call.stt_label = provider.label
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
        self.registry.mark_ended(call.call_uuid)
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
                call.direction, user_id=self.user_id,
            )
        except Exception:
            logger.exception("failed saving call history")
        if call.answered_at:
            quality.schedule(call.call_uuid)
        await self._to_browser({"type": "call_ended", "reason": reason})
        self.call = None


class CallManager:
    """Registry of per-user lines. Routes Vobiz webhooks and media streams
    to the owning user's line via the numbers mapping (ForwardedFrom / To);
    unmatched calls fall back to the first admin so the original
    single-tenant behaviour is preserved."""

    ENDED_TTL_S = 600

    def __init__(self) -> None:
        self.lines: dict[int, UserLine] = {}
        self.uuid_to_line: dict[str, UserLine] = {}
        # call UUIDs we already tore down; Vobiz re-hits the Answer URL for a
        # live call whose stream we closed, and that must NOT ring again
        self._ended_uuids: dict[str, float] = {}

    def line(self, user_id: int) -> UserLine:
        if user_id not in self.lines:
            self.lines[user_id] = UserLine(user_id, self)
        return self.lines[user_id]

    def default_line(self) -> Optional[UserLine]:
        import auth
        uid = auth.first_admin_id()
        return self.line(uid) if uid is not None else None

    def bind_uuid(self, call_uuid: str, line: UserLine) -> None:
        self.uuid_to_line[call_uuid] = line

    def mark_ended(self, call_uuid: str) -> None:
        self._ended_uuids[call_uuid] = time.time()
        self.uuid_to_line.pop(call_uuid, None)

    def was_recently_ended(self, call_uuid: str) -> bool:
        now = time.time()
        self._ended_uuids = {
            u: t for u, t in self._ended_uuids.items() if now - t < self.ENDED_TTL_S
        }
        return call_uuid in self._ended_uuids

    async def route_incoming(
        self, call_uuid: str, from_number: str, to_number: str,
        forwarded_from: str = "",
    ) -> None:
        if call_uuid in self.uuid_to_line:
            logger.info("duplicate answer webhook for %s — already routed", call_uuid)
            return
        import number_map
        user_id = number_map.resolve(forwarded_from, to_number)
        if user_id is not None:
            line = self.line(user_id)
            logger.info("call %s routed to user %s (fwd=%s)",
                        call_uuid, user_id, forwarded_from or "-")
        else:
            line = self.default_line()
            if line is None:
                logger.warning("call %s: no user to route to — dropping", call_uuid)
                return
            logger.info("call %s unmatched (fwd=%s to=%s) — default line user %s",
                        call_uuid, forwarded_from or "-", to_number, line.user_id)
        await line.register_pending(call_uuid, from_number, to_number)

    async def outbound_answered(self, call_uuid: str, to_number: str = "") -> bool:
        """Find the line whose outbound dial this answer webhook belongs to."""
        dialing = [
            l for l in self.lines.values()
            if l.call and l.call.direction == "out" and l.call.state == "dialing"
        ]
        if len(dialing) > 1 and to_number:
            import number_map
            tail = number_map._last10(to_number)
            matched = [l for l in dialing if number_map._last10(l.call.to_number) == tail]
            if matched:
                dialing = matched
        if dialing:
            return await dialing[0].outbound_answered(call_uuid)
        return False

    async def stream_started(self, ws: WebSocket, start: dict) -> Optional[UserLine]:
        call_id = start.get("callId") or ""
        line = self.uuid_to_line.get(call_id)
        if line is None:
            # Stream with no webhook context (e.g. backend restarted mid-call)
            line = self.default_line()
            if line is None:
                logger.warning("stream for unknown call %s and no default line", call_id)
                return None
        await line.vobiz_stream_started(ws, start)
        return line

    async def hangup_event(self, call_uuid: str, reason: str) -> None:
        line = self.uuid_to_line.get(call_uuid)
        if line is not None:
            await line.vobiz_hangup_event(reason)
            return
        # no UUID in callback (or unknown): tell every line with a live call
        for line in list(self.lines.values()):
            if line.call and line.call.state != "ended":
                await line.vobiz_hangup_event(reason)

    async def outbound_ringing(self) -> None:
        for line in list(self.lines.values()):
            if line.call and line.call.direction == "out" and line.call.state == "dialing":
                await line.outbound_ringing()


manager = CallManager()
