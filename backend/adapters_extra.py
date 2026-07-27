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
    # languages this adapter can genuinely transcribe; others must fall back.
    # No 'auto': Deepgram cannot auto-detect Indic languages in streaming.
    supports = {"hi", "en", "hinglish"}

    def __init__(self, name: str, label: str, api_key: str, model: str | None):
        self.name = name
        self.label = label
        self._api_key = api_key
        self._model = model or "nova-2"

    def create_session(self, language, on_event, sample_rate=16000):
        return DeepgramSTTSession(language, on_event, sample_rate,
                                  self._api_key, self._model)


# ---------- Google Cloud Speech-to-Text (REST, API-key) ----------

# primary language + alternates: Google detects among these per request
_GOOGLE_LANGS = {
    "auto": ("hi-IN", ["gu-IN", "en-IN"]),
    "hi": ("hi-IN", []),
    "gu": ("gu-IN", []),
    "en": ("en-IN", []),
    "hinglish": ("hi-IN", ["en-IN"]),
}

_G_CHUNK_BYTES = 16000 * 2 * 3   # ~3s of 16kHz pcm16 per request
_G_SILENCE_MEAN = 150            # skip near-silent chunks to save quota


def _google_bearer(sa_json: str) -> str:
    """Mint an OAuth2 access token from pasted service-account JSON."""
    import json as _json

    from google.auth.transport.requests import Request as _GRequest
    from google.oauth2 import service_account as _sa

    creds = _sa.Credentials.from_service_account_info(
        _json.loads(sa_json),
        scopes=["https://www.googleapis.com/auth/cloud-platform"],
    )
    creds.refresh(_GRequest())
    return creds.token


class GoogleSTTSession:
    def __init__(self, language: str, on_event: OnEvent, sample_rate: int,
                 api_key: str):
        self.language = language
        self.on_event = on_event
        self.sample_rate = sample_rate
        self.api_key = api_key.strip()
        self._buf = bytearray()
        self._queue: asyncio.Queue = asyncio.Queue()
        self._worker: Optional[asyncio.Task] = None
        self._closed = False
        self._errored = False

    async def start(self) -> None:
        self._worker = asyncio.create_task(self._work_loop())
        logger.info("google stt session started (language=%s)", self.language)

    async def send_pcm(self, pcm: bytes) -> None:
        if self._closed:
            return
        self._buf += pcm
        if len(self._buf) >= _G_CHUNK_BYTES:
            self._queue.put_nowait(bytes(self._buf))
            self._buf.clear()

    async def _work_loop(self) -> None:
        import base64 as b64
        import struct as st
        primary, alts = _GOOGLE_LANGS.get(self.language, _GOOGLE_LANGS["auto"])
        config = {
            "encoding": "LINEAR16",
            "sampleRateHertz": self.sample_rate,
            "languageCode": primary,
            "enableAutomaticPunctuation": True,
        }
        if alts:
            config["alternativeLanguageCodes"] = alts
        headers = {}
        if self.api_key.startswith("{"):
            # service-account JSON pasted as the key -> proper OAuth token
            try:
                token = await asyncio.to_thread(_google_bearer, self.api_key)
                headers["Authorization"] = f"Bearer {token}"
                url = "https://speech.googleapis.com/v1/speech:recognize"
            except Exception as exc:
                logger.exception("google service-account auth failed")
                await self.on_event({
                    "type": "error",
                    "message": f"Google auth failed: {exc}",
                })
                return
        else:
            url = f"https://speech.googleapis.com/v1/speech:recognize?key={self.api_key}"
        async with httpx.AsyncClient(timeout=20, headers=headers) as client:
            while True:
                chunk = await self._queue.get()
                if chunk is None:
                    return
                n = len(chunk) // 2
                mean_abs = sum(
                    abs(s) for s in st.unpack(f"<{n}h", chunk[: n * 2])
                ) // max(n, 1)
                if mean_abs < _G_SILENCE_MEAN:
                    continue
                try:
                    resp = await client.post(url, json={
                        "config": config,
                        "audio": {"content": b64.b64encode(chunk).decode()},
                    })
                    if resp.status_code >= 300:
                        logger.error("google stt %s: %s",
                                     resp.status_code, resp.text[:200])
                        if not self._errored:
                            self._errored = True
                            await self.on_event({
                                "type": "error",
                                "message": f"Google STT error {resp.status_code}",
                            })
                        continue
                    for result in resp.json().get("results", []):
                        alt = (result.get("alternatives") or [{}])[0]
                        text = (alt.get("transcript") or "").strip()
                        if text:
                            await self.on_event({
                                "type": "transcript",
                                "text": text,
                                "language_code": result.get("languageCode"),
                            })
                except Exception:
                    logger.exception("google stt request failed")

    async def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        if self._buf:
            self._queue.put_nowait(bytes(self._buf))
            self._buf.clear()
        self._queue.put_nowait(None)
        if self._worker:
            try:
                await asyncio.wait_for(self._worker, timeout=8)
            except Exception:
                self._worker.cancel()


class GoogleSTT:
    supports = {"auto", "hi", "gu", "en", "hinglish"}

    def __init__(self, name: str, label: str, api_key: str, model: str | None):
        self.name = name
        self.label = label
        self._api_key = api_key

    def create_session(self, language, on_event, sample_rate=16000):
        return GoogleSTTSession(language, on_event, sample_rate, self._api_key)


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
