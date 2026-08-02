"""Type-to-speak: synthesize arbitrary user text into call-ready PCM.

The TTS language follows the script the user typed in (Gujarati script ->
Gujarati voice, Devanagari -> Hindi, Latin -> Hindi voice which handles
Hinglish/English well). Short phrases are cached — quick-board taps repeat
constantly and shouldn't cost a TTS round trip every time.
"""

import logging
from collections import OrderedDict

import providers

logger = logging.getLogger("speech")

MAX_TEXT_LEN = 300
_CACHE_MAX = 200
_CACHE_TEXT_LEN = 60  # only cache short phrases (board taps, chips)
_cache: OrderedDict[tuple, bytes] = OrderedDict()


def detect_language(text: str) -> str:
    for ch in text:
        code = ord(ch)
        if 0x0A80 <= code <= 0x0AFF:
            return "gu-IN"
        if 0x0900 <= code <= 0x097F:
            return "hi-IN"
    return "hi-IN"


async def speak_pcm(text: str, speaker: str | None = None) -> bytes | None:
    text = " ".join(text.split())[:MAX_TEXT_LEN]
    if not text:
        return None
    tts = providers.get_tts()
    language = detect_language(text)
    key = (tts.name, speaker or "", language, text)
    if key in _cache:
        _cache.move_to_end(key)
        return _cache[key]
    pcm = await tts.synthesize(text, language, speaker=speaker)
    if pcm and len(text) <= _CACHE_TEXT_LEN:
        _cache[key] = pcm
        while len(_cache) > _CACHE_MAX:
            _cache.popitem(last=False)
    return pcm
