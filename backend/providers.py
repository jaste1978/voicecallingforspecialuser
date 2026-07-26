"""Pluggable AI provider registry.

Every AI-powered step goes through an interface here, so any model can be
swapped in at any process:

  - STTProvider: streaming speech-to-text (captions)
  - TTSProvider: text-to-speech (spoken prompts into calls)

To add a provider (e.g. OpenAI, Deepgram, Google, AI4Bharat):
  1. implement the interface below in a new class,
  2. register it in STT_PROVIDERS / TTS_PROVIDERS,
  3. it appears in the app's Settings automatically.

The active provider is chosen in Settings (stored in the DB), falling back
to STT_PROVIDER / TTS_PROVIDER env vars, then to Sarvam. Sessions read the
setting at creation time, so a switch applies from the next call/caption
session onward.
"""

import base64
import io
import logging
import os
import wave
from typing import Awaitable, Callable, Protocol

import settings_store
from sarvam_relay import SarvamSTTSession, get_client

logger = logging.getLogger("providers")

OnEvent = Callable[[dict], Awaitable[None]]


class STTSession(Protocol):
    async def start(self) -> None: ...
    async def send_pcm(self, pcm: bytes) -> None: ...
    async def close(self) -> None: ...


class STTProvider(Protocol):
    name: str
    label: str

    def create_session(
        self, language: str, on_event: OnEvent, sample_rate: int = 16000
    ) -> STTSession: ...


class TTSProvider(Protocol):
    name: str
    label: str

    async def synthesize(self, text: str, language: str = "hi-IN") -> bytes | None:
        """Return raw 16kHz mono pcm_s16le audio for the text."""
        ...


# ---------- Sarvam adapters ----------

class SarvamSTT:
    name = "sarvam"
    label = "Sarvam saaras:v3"

    def create_session(self, language, on_event, sample_rate=16000):
        return SarvamSTTSession(language, on_event, sample_rate=sample_rate)


class SarvamTTS:
    name = "sarvam"
    label = "Sarvam Bulbul"

    async def synthesize(self, text, language="hi-IN"):
        try:
            client = get_client()
            resp = await client.text_to_speech.convert(
                text=text,
                target_language_code=language,
                speech_sample_rate=16000,
            )
            wav_bytes = base64.b64decode(resp.audios[0])
            with wave.open(io.BytesIO(wav_bytes), "rb") as w:
                assert w.getsampwidth() == 2 and w.getframerate() == 16000
                return w.readframes(w.getnframes())
        except Exception:
            logger.exception("Sarvam TTS synthesize failed")
            return None


# ---------- registry ----------

STT_PROVIDERS: dict[str, STTProvider] = {p.name: p for p in [SarvamSTT()]}
TTS_PROVIDERS: dict[str, TTSProvider] = {p.name: p for p in [SarvamTTS()]}


def get_stt() -> STTProvider:
    name = settings_store.get("stt_provider") or os.environ.get("STT_PROVIDER", "sarvam")
    return STT_PROVIDERS.get(name, STT_PROVIDERS["sarvam"])


def get_tts() -> TTSProvider:
    name = settings_store.get("tts_provider") or os.environ.get("TTS_PROVIDER", "sarvam")
    return TTS_PROVIDERS.get(name, TTS_PROVIDERS["sarvam"])


def describe() -> dict:
    return {
        "stt_provider": get_stt().name,
        "tts_provider": get_tts().name,
        "available": {
            "stt": [{"name": p.name, "label": p.label} for p in STT_PROVIDERS.values()],
            "tts": [{"name": p.name, "label": p.label} for p in TTS_PROVIDERS.values()],
        },
    }


def set_active(kind: str, name: str) -> bool:
    registry = STT_PROVIDERS if kind == "stt" else TTS_PROVIDERS
    if name not in registry:
        return False
    settings_store.set(f"{kind}_provider", name)
    logger.info("active %s provider set to %s", kind, name)
    return True
