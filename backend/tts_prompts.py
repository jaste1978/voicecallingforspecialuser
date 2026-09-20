"""Short spoken prompts the user can play into the call.

Synthesized via the active TTS provider (see providers.py), cached per
provider as raw 16kHz pcm_s16le ready for Vobiz playAudio frames.

Some prompts ship as a fixed pre-rendered file instead of runtime TTS —
the callback greeting is voiced by Shreya (a premium voice) and never
changes, so a bundled 16kHz mono pcm_s16le asset guarantees the exact
delivery with no per-call cost or TTS dependency.
"""

import logging
import os

import providers

logger = logging.getLogger("tts_prompts")

_ASSET_DIR = os.path.join(os.path.dirname(__file__), "assets")

# name -> bundled raw pcm_s16le @16kHz mono. Preferred over runtime TTS.
PROMPT_AUDIO_FILES = {
    "callback": os.path.join(_ASSET_DIR, "callback_hi.pcm"),
}

PROMPTS = {
    "slow_down": "कृपया थोड़ा धीरे बोलिए, ताकि मैं आपकी बात अच्छे से समझ सकूँ। धन्यवाद।",
    "repeat": "कृपया अपनी बात दोबारा कहिए।",
    "wait": "कृपया एक क्षण रुकिए।",
    # Played to anyone who dials the shared number back — one message for all,
    # known caller or stranger (it explains what SunoSathi is either way).
    "callback": "नमस्ते, यह SunoSathi है। किसी अपने ने आपको इस app से "
                "call किया था। हमने उन्हें आपके call के बारे में बता दिया — "
                "वे आपसे संपर्क करेंगे।",
}

# Per-prompt voice override for runtime TTS; falls back to the default.
PROMPT_SPEAKERS: dict[str, str] = {}

_cache: dict[str, bytes] = {}


async def get_prompt_pcm(name: str) -> bytes | None:
    # A bundled audio file wins — used for the fixed callback greeting.
    path = PROMPT_AUDIO_FILES.get(name)
    if path:
        if name not in _cache:
            try:
                with open(path, "rb") as f:
                    _cache[name] = f.read()
                logger.info("prompt '%s' loaded from asset (%d bytes)",
                            name, len(_cache[name]))
            except OSError:
                logger.warning("prompt asset missing for '%s' (%s) — TTS fallback",
                               name, path)
        if name in _cache:
            return _cache[name]

    if name not in PROMPTS:
        return None
    tts = providers.get_tts()
    speaker = PROMPT_SPEAKERS.get(name)
    cache_key = f"{tts.name}:{name}:{speaker or ''}"
    if cache_key in _cache:
        return _cache[cache_key]
    pcm = await tts.synthesize(PROMPTS[name], "hi-IN", speaker=speaker)
    if pcm:
        _cache[cache_key] = pcm
        logger.info("TTS prompt '%s' generated via %s (%d bytes)", name, tts.name, len(pcm))
    return pcm
