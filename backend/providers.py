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

import provider_store
from adapters_extra import DeepgramSTT, ElevenLabsTTS, GoogleSTT

BUILTIN_STT: dict[str, STTProvider] = {p.name: p for p in [SarvamSTT()]}
BUILTIN_TTS: dict[str, TTSProvider] = {p.name: p for p in [SarvamTTS()]}

# Adapters a user can activate by adding an API key in the Admin UI.
ADDABLE = {
    "stt": [
        {"adapter": "deepgram", "label": "Deepgram (streaming STT)",
         "model_hint": "model id, e.g. nova-2 (optional)"},
        {"adapter": "google", "label": "Google Speech-to-Text",
         "model_hint": "no model id needed"},
    ],
    "tts": [
        {"adapter": "elevenlabs", "label": "ElevenLabs (TTS)",
         "model_hint": "voice id (optional)"},
    ],
}


def _build_from_config(cfg: dict):
    name = f"cfg:{cfg['id']}"
    if cfg["adapter"] == "deepgram":
        return DeepgramSTT(name, cfg["label"], cfg["api_key"], cfg.get("model"))
    if cfg["adapter"] == "google":
        return GoogleSTT(name, cfg["label"], cfg["api_key"], cfg.get("model"))
    if cfg["adapter"] == "elevenlabs":
        return ElevenLabsTTS(name, cfg["label"], cfg["api_key"], cfg.get("model"))
    return None


def _registry(kind: str) -> dict:
    reg = dict(BUILTIN_STT if kind == "stt" else BUILTIN_TTS)
    for cfg in provider_store.list_configs(kind):
        p = _build_from_config(cfg)
        if p is not None:
            reg[p.name] = p
    return reg


def get_stt(language: str | None = None) -> STTProvider:
    name = settings_store.get("stt_provider") or os.environ.get("STT_PROVIDER", "sarvam")
    reg = _registry("stt")
    provider = reg.get(name, reg["sarvam"])
    # capability routing: if the chosen provider can't transcribe this
    # language, fall back to Sarvam (supports all app languages) rather
    # than silently producing no captions
    supports = getattr(provider, "supports", None)
    if language and supports is not None and language not in supports:
        logger.info(
            "%s does not support language '%s' — falling back to sarvam",
            provider.name, language,
        )
        return reg["sarvam"]
    return provider


def get_tts() -> TTSProvider:
    name = settings_store.get("tts_provider") or os.environ.get("TTS_PROVIDER", "sarvam")
    reg = _registry("tts")
    return reg.get(name, reg["sarvam"])


def _mask(key: str) -> str:
    return key[:4] + "…" + key[-4:] if len(key) > 10 else "•••"


def describe() -> dict:
    return {
        "stt_provider": get_stt().name,
        "tts_provider": get_tts().name,
        "available": {
            kind: [{"name": p.name, "label": p.label} for p in _registry(kind).values()]
            for kind in ("stt", "tts")
        },
        "addable": ADDABLE,
        "configured": {
            kind: [
                {"id": c["id"], "name": f"cfg:{c['id']}", "adapter": c["adapter"],
                 "label": c["label"], "model": c.get("model"),
                 "api_key_masked": _mask(c["api_key"])}
                for c in provider_store.list_configs(kind)
            ]
            for kind in ("stt", "tts")
        },
    }


def add_config(kind: str, adapter: str, label: str, api_key: str, model: str | None) -> bool:
    if kind not in ("stt", "tts"):
        return False
    if adapter not in {a["adapter"] for a in ADDABLE[kind]}:
        return False
    if not label.strip() or not api_key.strip():
        return False
    provider_store.add(kind, adapter, label.strip(), api_key.strip(), model or None)
    logger.info("added %s provider config: %s (%s)", kind, label, adapter)
    return True


def delete_config(config_id: int) -> None:
    cfg = provider_store.get(config_id)
    provider_store.delete(config_id)
    # if the deleted model was active, fall back to sarvam
    if cfg:
        for kind in ("stt", "tts"):
            if settings_store.get(f"{kind}_provider") == f"cfg:{config_id}":
                settings_store.set(f"{kind}_provider", "sarvam")


def set_active(kind: str, name: str) -> bool:
    if name not in _registry(kind):
        return False
    settings_store.set(f"{kind}_provider", name)
    logger.info("active %s provider set to %s", kind, name)
    return True
