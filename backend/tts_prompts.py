"""Short spoken prompts the user can play into the call.

Synthesized via the active TTS provider (see providers.py), cached per
provider as raw 16kHz pcm_s16le ready for Vobiz playAudio frames.
"""

import logging

import providers

logger = logging.getLogger("tts_prompts")

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

# Per-prompt voice override; falls back to the TTS default when absent.
PROMPT_SPEAKERS = {
    "callback": "rahul",
}

_cache: dict[str, bytes] = {}


async def get_prompt_pcm(name: str) -> bytes | None:
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
