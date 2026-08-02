"""Automatic post-call caption quality scoring.

After every answered call, the caller recording is re-transcribed with the
batch STT (full context — our measured reference quality) and the live
captions are scored against it (word-level agreement). Stored on the call
record and shown in the Monitor and History UIs.
"""

import asyncio
import io
import logging
import re
import wave
from difflib import SequenceMatcher
from functools import lru_cache

import history
import recorder
from sarvam_relay import get_client

logger = logging.getLogger("quality")

CHUNK_S = 28  # sync transcribe endpoint caps at 30s


async def _transcribe_batch(wav_path) -> str:
    client = get_client()
    with wave.open(str(wav_path), "rb") as w:
        rate = w.getframerate()
        pcm = w.readframes(w.getnframes())
    chunk_bytes = rate * 2 * CHUNK_S
    parts = []
    for i in range(0, len(pcm), chunk_bytes):
        buf = io.BytesIO()
        with wave.open(buf, "wb") as out:
            out.setnchannels(1)
            out.setsampwidth(2)
            out.setframerate(rate)
            out.writeframes(pcm[i:i + chunk_bytes])
        buf.seek(0)
        resp = await client.speech_to_text.transcribe(
            file=("call.wav", buf, "audio/wav"),
            model="saarika:v2.5", language_code="unknown",
        )
        if resp.transcript:
            parts.append(resp.transcript.strip())
    return " ".join(parts)


def _norm_words(text: str) -> list[str]:
    text = text.lower().replace("'", "").replace("’", "")  # can't == cant == कांट
    text = re.sub(r"[।,.!?\"—:;()\-]", " ", text)
    # Devanagari cosmetic variants: drop nukta (ज़==ज), unify chandrabindu
    # with anusvara (हूँ==हूं) — spelling style, not transcription errors
    text = text.replace("़", "").replace("ँ", "ं")
    return [w for w in text.split() if w]


# One model may write mixed-language speech in Latin ("can you hear me")
# while the other writes the same words phonetically in Devanagari
# ("कैन यू हियर मी"). Both are correct transcriptions, so scoring must be
# script-blind: romanize everything and compare words fuzzily.

_DEV_ROMAN = {
    "अ": "a", "आ": "a", "इ": "i", "ई": "i", "उ": "u", "ऊ": "u", "ऋ": "ri",
    "ए": "e", "ऐ": "ai", "ओ": "o", "औ": "au", "ऍ": "e", "ऑ": "o",
    "क": "k", "ख": "kh", "ग": "g", "घ": "gh", "ङ": "n",
    "च": "ch", "छ": "chh", "ज": "j", "झ": "jh", "ञ": "n",
    "ट": "t", "ठ": "th", "ड": "d", "ढ": "dh", "ण": "n",
    "त": "t", "थ": "th", "द": "d", "ध": "dh", "न": "n",
    "प": "p", "फ": "f", "ब": "b", "भ": "bh", "म": "m",
    "य": "y", "र": "r", "ल": "l", "ळ": "l", "व": "v",
    "श": "sh", "ष": "sh", "स": "s", "ह": "h",
    "ा": "a", "ि": "i", "ी": "i", "ु": "u", "ू": "u", "ृ": "ri",
    "े": "e", "ै": "ai", "ो": "o", "ौ": "au", "ॅ": "e", "ॉ": "o",
    "ं": "n", "ः": "", "्": "", "ऽ": "",
    "०": "0", "१": "1", "२": "2", "३": "3", "४": "4",
    "५": "5", "६": "6", "७": "7", "८": "8", "९": "9",
}


def _romanize(word: str) -> str:
    out = []
    for ch in word:
        code = ord(ch)
        # All nine major Indic blocks (Devanagari, Bengali, Gurmukhi,
        # Gujarati, Oriya, Tamil, Telugu, Kannada, Malayalam) share the
        # same ISCII-derived layout in parallel 0x80-wide blocks, so any
        # of them maps onto Devanagari positionally. The auto language
        # detect writes short utterances in random scripts ("હા" as "ਹਾਂ"
        # or "ಹಾ") — phonetically identical, so score them as identical.
        if 0x0900 <= code <= 0x0D7F:
            ch = chr(0x0900 + ((code - 0x0900) % 0x80))
        out.append(_DEV_ROMAN.get(ch, ch))
    return "".join(out)


@lru_cache(maxsize=4096)
def _words_match(a: str, b: str) -> bool:
    if a == b:
        return True
    ra, rb = _romanize(a), _romanize(b)
    if ra == rb:
        return True
    # transliteration is approximate ("kain" vs "can"), so accept close
    # romanized spellings as the same spoken word; very short words get a
    # looser bar since one differing letter dominates the ratio ("ij"/"is")
    ratio = SequenceMatcher(None, ra, rb).ratio()
    return ratio >= (0.5 if max(len(ra), len(rb)) <= 3 else 0.55)


def _wer(ref: list[str], hyp: list[str]) -> float:
    d = [[0] * (len(hyp) + 1) for _ in range(len(ref) + 1)]
    for i in range(len(ref) + 1):
        d[i][0] = i
    for j in range(len(hyp) + 1):
        d[0][j] = j
    for i in range(1, len(ref) + 1):
        for j in range(1, len(hyp) + 1):
            cost = 0 if _words_match(ref[i - 1], hyp[j - 1]) else 1
            d[i][j] = min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
    return d[len(ref)][len(hyp)] / max(len(ref), 1)


async def run_for(call_uuid: str) -> None:
    """Fire-and-forget after call end; never raises."""
    try:
        path = recorder.path_for(call_uuid, "caller")
        if path is None:
            return
        call = history.get_by_uuid(call_uuid)
        if call is None:
            return
        reference = await _transcribe_batch(path)
        ref_words = _norm_words(reference)
        if not ref_words:
            return  # no speech worth scoring
        # 🔊-marked lines are the user's typed speech, not caller captions
        captions = [t for t in (call.get("transcript") or []) if not t.startswith("🔊")]
        live_words = _norm_words(" ".join(captions))
        # symmetric similarity: edit distance normalized by the longer text,
        # so length mismatch in either direction degrades but never explodes
        dist = _wer(ref_words, live_words) * max(len(ref_words), 1)
        score = max(0.0, 1.0 - dist / max(len(ref_words), len(live_words), 1)) * 100
        history.update_quality(call_uuid, round(score), reference)
        logger.info("quality for %s: %d%% (%d ref words)",
                    call_uuid, round(score), len(ref_words))
    except Exception:
        logger.exception("quality scoring failed for %s", call_uuid)


def rescore_stored(call_uuid: str) -> int | None:
    """Re-score against the already-stored batch reference (no STT cost).
    Used after scoring-algorithm improvements. Returns the new score."""
    call = history.get_by_uuid(call_uuid)
    if not call or not call.get("batch_transcript"):
        return None
    ref_words = _norm_words(call["batch_transcript"])
    if not ref_words:
        return None
    captions = [t for t in (call.get("transcript") or []) if not t.startswith("🔊")]
    live_words = _norm_words(" ".join(captions))
    dist = _wer(ref_words, live_words) * max(len(ref_words), 1)
    score = max(0.0, 1.0 - dist / max(len(ref_words), len(live_words), 1)) * 100
    history.update_quality(call_uuid, round(score), call["batch_transcript"])
    return round(score)


def schedule(call_uuid: str) -> None:
    asyncio.get_running_loop().create_task(run_for(call_uuid))
