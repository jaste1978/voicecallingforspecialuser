"""Additional AI provider adapters, activated by user-supplied API keys.

Each class implements the interfaces in providers.py. They surface failures
as stt_error events / None results so a bad key never crashes a call.
"""

import asyncio
import json
import logging
from typing import Awaitable, Callable, Optional

import httpx
import websockets

logger = logging.getLogger("adapters_extra")

OnEvent = Callable[[dict], Awaitable[None]]


# ---------- Deepgram streaming STT ----------

# Deepgram has no reliable auto-detect for Indic streaming ('multi' returns
# empty transcripts for Hindi on nova-2), so 'auto' leans Hindi. Gujarati is
# unsupported and approximates to Hindi — use Sarvam for Gujarati callers.
_DG_LANG = {
    "en": "en-IN",
    "hi": "hi",
    "hinglish": "hi-Latn",
    "gu": "hi",
    "auto": "hi",
}


class DeepgramSTTSession:
    def __init__(self, language: str, on_event: OnEvent, sample_rate: int,
                 api_key: str, model: str):
        self.language = language
        self.on_event = on_event
        self.sample_rate = sample_rate
        self.api_key = api_key
        self.model = model or "nova-2"
        self._ws = None
        self._reader: Optional[asyncio.Task] = None
        self._closed = False

    async def start(self) -> None:
        params = [
            "encoding=linear16",
            f"sample_rate={self.sample_rate}",
            f"model={self.model}",
            "punctuate=true",
            "interim_results=false",
        ]
        lang = _DG_LANG.get(self.language)
        if lang:
            params.append(f"language={lang}")
        url = "wss://api.deepgram.com/v1/listen?" + "&".join(params)
        self._ws = await websockets.connect(
            url, additional_headers={"Authorization": f"Token {self.api_key}"}
        )
        self._reader = asyncio.create_task(self._read_loop())
        logger.info("deepgram session started (model=%s lang=%s)", self.model, lang)

    async def send_pcm(self, pcm: bytes) -> None:
        if self._ws is not None and not self._closed:
            await self._ws.send(pcm)

    async def _read_loop(self) -> None:
        try:
            async for raw in self._ws:
                msg = json.loads(raw)
                if msg.get("type") == "Results":
                    alt = (msg.get("channel", {}).get("alternatives") or [{}])[0]
                    text = (alt.get("transcript") or "").strip()
                    if text and msg.get("is_final"):
                        await self.on_event({
                            "type": "transcript",
                            "text": text,
                            "language_code": _DG_LANG.get(self.language) or "auto",
                        })
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            if not self._closed:
                logger.exception("deepgram read loop died")
                await self.on_event({"type": "error", "message": f"Deepgram: {exc}"})

    async def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        if self._reader:
            self._reader.cancel()
        if self._ws is not None:
            try:
                await self._ws.send(json.dumps({"type": "CloseStream"}))
                await self._ws.close()
            except Exception:
                pass


class DeepgramSTT:
    def __init__(self, name: str, label: str, api_key: str, model: str | None):
        self.name = name
        self.label = label
        self._api_key = api_key
        self._model = model or "nova-2"

    def create_session(self, language, on_event, sample_rate=16000):
        return DeepgramSTTSession(language, on_event, sample_rate,
                                  self._api_key, self._model)


# ---------- ElevenLabs TTS ----------

class ElevenLabsTTS:
    DEFAULT_VOICE = "21m00Tcm4TlvDq8ikWAM"  # "Rachel"

    def __init__(self, name: str, label: str, api_key: str, voice_id: str | None):
        self.name = name
        self.label = label
        self._api_key = api_key
        self._voice = voice_id or self.DEFAULT_VOICE

    async def synthesize(self, text: str, language: str = "hi-IN") -> bytes | None:
        url = (
            f"https://api.elevenlabs.io/v1/text-to-speech/{self._voice}"
            "?output_format=pcm_16000"
        )
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.post(
                    url,
                    headers={"xi-api-key": self._api_key},
                    json={"text": text, "model_id": "eleven_multilingual_v2"},
                )
            if resp.status_code >= 300:
                logger.error("elevenlabs TTS failed %s: %s",
                             resp.status_code, resp.text[:200])
                return None
            return resp.content  # raw 16kHz pcm_s16le
        except Exception:
            logger.exception("elevenlabs TTS failed")
            return None
