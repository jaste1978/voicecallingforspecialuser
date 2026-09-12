"""Type-to-speak: synthesize arbitrary user text into call-ready PCM.

The TTS language follows the script the user typed in (Gujarati script ->
Gujarati voice, Tamil -> Tamil, ... Devanagari -> Hindi, Latin -> Hindi voice
which handles Hinglish/English well). Short phrases are cached — quick-board taps repeat
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


# Unicode block -> Bulbul language. Devanagari stays hi-IN (Marathi reads
# acceptably in the Hindi voice); Latin/Hinglish also goes to the Hindi voice.
_SCRIPT_LANG = (
    (0x0900, 0x097F, "hi-IN"), (0x0980, 0x09FF, "bn-IN"), (0x0A00, 0x0A7F, "pa-IN"),
    (0x0A80, 0x0AFF, "gu-IN"), (0x0B00, 0x0B7F, "od-IN"), (0x0B80, 0x0BFF, "ta-IN"),
    (0x0C00, 0x0C7F, "te-IN"), (0x0C80, 0x0CFF, "kn-IN"), (0x0D00, 0x0D7F, "ml-IN"),
)


def detect_language(text: str) -> str:
    for ch in text:
        code = ord(ch)
        for lo, hi, lang in _SCRIPT_LANG:
            if lo <= code <= hi:
                return lang
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
