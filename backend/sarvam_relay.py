"""Streaming STT relay: raw 16kHz pcm_s16le audio in -> Sarvam saaras:v3 -> transcript events out.

One SarvamSTTSession wraps one Sarvam streaming websocket. Audio is fed with
send_pcm(); transcript/VAD events are delivered to the on_event callback as dicts:

    {"type": "transcript", "text": str, "language_code": str | None}
    {"type": "vad", "signal": "START_SPEECH" | "END_SPEECH"}
    {"type": "error", "message": str}
"""

import asyncio
import base64
import logging
import os
from pathlib import Path
from typing import Awaitable, Callable, Optional

from dotenv import load_dotenv
from sarvamai import AsyncSarvamAI

load_dotenv(Path(__file__).resolve().parent / ".env")

logger = logging.getLogger("sarvam_relay")

SAMPLE_RATE = 16000

# UI language choices -> Sarvam streaming params
LANGUAGE_PRESETS = {
    "hi": {"language_code": "hi-IN", "mode": "transcribe"},
    "gu": {"language_code": "gu-IN", "mode": "transcribe"},
    "en": {"language_code": "en-IN", "mode": "transcribe"},
    # Hinglish / mixed speech: codemix keeps both scripts, language auto-detected
    "hinglish": {"language_code": "unknown", "mode": "codemix"},
    "auto": {"language_code": "unknown", "mode": "transcribe"},
}


def get_client() -> AsyncSarvamAI:
    api_key = os.environ.get("SARVAM_API_KEY")
    if not api_key:
        raise RuntimeError("SARVAM_API_KEY missing — put it in backend/.env")
    return AsyncSarvamAI(api_subscription_key=api_key)


class SarvamSTTSession:
    def __init__(
        self,
        language: str,
        on_event: Callable[[dict], Awaitable[None]],
        sample_rate: int = SAMPLE_RATE,
    ):
        preset = LANGUAGE_PRESETS.get(language, LANGUAGE_PRESETS["auto"])
        self.language_code = preset["language_code"]
        self.mode = preset["mode"]
        self.sample_rate = sample_rate
        self.on_event = on_event
        self._ws = None
        self._ctx = None
        self._reader_task: Optional[asyncio.Task] = None
        self._closed = False

    async def start(self) -> None:
        client = get_client()
        self._ctx = client.speech_to_text_streaming.connect(
            language_code=self.language_code,
            model="saaras:v3",
            mode=self.mode,
            sample_rate=str(self.sample_rate),
            input_audio_codec="pcm_s16le",
            high_vad_sensitivity=True,
            vad_signals=True,
        )
        self._ws = await self._ctx.__aenter__()
        self._reader_task = asyncio.create_task(self._read_loop())
        logger.info(
            "Sarvam session started (language=%s mode=%s rate=%s)",
            self.language_code, self.mode, self.sample_rate,
        )

    async def send_pcm(self, pcm: bytes) -> None:
        """Feed raw little-endian 16-bit mono PCM at self.sample_rate."""
        if self._ws is None or self._closed:
            return
        audio_b64 = base64.b64encode(pcm).decode("ascii")
        await self._ws.transcribe(
            audio=audio_b64, encoding="audio/wav", sample_rate=self.sample_rate
        )

    async def _read_loop(self) -> None:
        try:
            async for message in self._ws:
                mtype = getattr(message, "type", None)
                data = getattr(message, "data", None)
                if mtype == "data" and data is not None:
                    text = (getattr(data, "transcript", "") or "").strip()
                    if text:
                        await self.on_event({
                            "type": "transcript",
                            "text": text,
                            "language_code": getattr(data, "language_code", None),
                        })
                elif mtype == "events" and data is not None:
                    signal = getattr(data, "signal_type", None)
                    if signal:
                        await self.on_event({"type": "vad", "signal": str(signal)})
                elif mtype == "error":
                    msg = str(getattr(data, "message", data))
                    logger.error("Sarvam error: %s", msg)
                    await self.on_event({"type": "error", "message": msg})
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            if not self._closed:
                logger.exception("Sarvam read loop died")
                await self.on_event({"type": "error", "message": f"STT stream closed: {exc}"})

    async def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        if self._reader_task:
            self._reader_task.cancel()
        if self._ctx is not None:
            try:
                await self._ctx.__aexit__(None, None, None)
            except Exception:
                pass
        logger.info("Sarvam session closed")
