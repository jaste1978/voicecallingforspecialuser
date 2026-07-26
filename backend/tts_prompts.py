"""Short spoken prompts the user can play into the call (Sarvam Bulbul TTS).

Generated once on first use, cached as raw 16kHz pcm_s16le ready for
Vobiz playAudio frames.
"""

import base64
import io
import logging
import wave

from sarvam_relay import get_client

logger = logging.getLogger("tts_prompts")

PROMPTS = {
    "slow_down": "कृपया थोड़ा धीरे बोलिए, ताकि मैं आपकी बात अच्छे से समझ सकूँ। धन्यवाद।",
    "repeat": "कृपया अपनी बात दोबारा कहिए।",
    "wait": "कृपया एक क्षण रुकिए।",
}

_cache: dict[str, bytes] = {}


def _wav_to_pcm(wav_bytes: bytes) -> bytes:
    with wave.open(io.BytesIO(wav_bytes), "rb") as w:
        assert w.getsampwidth() == 2 and w.getframerate() == 16000, "expected 16k PCM16"
        return w.readframes(w.getnframes())


async def get_prompt_pcm(name: str) -> bytes | None:
    if name not in PROMPTS:
        return None
    if name in _cache:
        return _cache[name]
    try:
        client = get_client()
        resp = await client.text_to_speech.convert(
            text=PROMPTS[name],
            target_language_code="hi-IN",
            speech_sample_rate=16000,
        )
        wav_bytes = base64.b64decode(resp.audios[0])
        pcm = _wav_to_pcm(wav_bytes)
        _cache[name] = pcm
        logger.info("TTS prompt '%s' generated (%d bytes pcm)", name, len(pcm))
        return pcm
    except Exception:
        logger.exception("TTS prompt '%s' failed", name)
        return None
