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
    # Played to someone who dials the shared number back. Known = we found
    # who called them and have notified that user; unknown = a stranger, who
    # at least learns what SunoSathi is.
    "callback_known": "नमस्ते, यह SunoSathi है। किसी अपने ने आपको इस app से "
                      "call किया था। हमने उन्हें आपके call के बारे में बता दिया — "
                      "वे आपसे संपर्क करेंगे।",
    "callback_unknown": "नमस्ते, यह SunoSathi है — सुनने में असमर्थ लोगों के लिए "
                        "एक app। किसी ने आपको इससे call किया होगा। कृपया उन्हें "
                        "उनके अपने नंबर पर call कीजिए।",
}

_cache: dict[str, bytes] = {}


async def get_prompt_pcm(name: str) -> bytes | None:
    if name not in PROMPTS:
        return None
    tts = providers.get_tts()
    cache_key = f"{tts.name}:{name}"
    if cache_key in _cache:
        return _cache[cache_key]
    pcm = await tts.synthesize(PROMPTS[name], "hi-IN")
    if pcm:
        _cache[cache_key] = pcm
        logger.info("TTS prompt '%s' generated via %s (%d bytes)", name, tts.name, len(pcm))
    return pcm
