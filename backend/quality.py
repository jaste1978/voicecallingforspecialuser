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
    text = re.sub(r"[।,.!?\"'—:;()\-]", " ", text.lower())
    # Devanagari cosmetic variants: drop nukta (ज़==ज), unify chandrabindu
    # with anusvara (हूँ==हूं) — spelling style, not transcription errors
    text = text.replace("़", "").replace("ँ", "ं")
    return [w for w in text.split() if w]


def _wer(ref: list[str], hyp: list[str]) -> float:
    d = [[0] * (len(hyp) + 1) for _ in range(len(ref) + 1)]
    for i in range(len(ref) + 1):
        d[i][0] = i
    for j in range(len(hyp) + 1):
        d[0][j] = j
    for i in range(1, len(ref) + 1):
        for j in range(1, len(hyp) + 1):
            cost = 0 if ref[i - 1] == hyp[j - 1] else 1
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
        live_words = _norm_words(" ".join(call.get("transcript") or []))
        # symmetric similarity: edit distance normalized by the longer text,
        # so length mismatch in either direction degrades but never explodes
        dist = _wer(ref_words, live_words) * max(len(ref_words), 1)
        score = max(0.0, 1.0 - dist / max(len(ref_words), len(live_words), 1)) * 100
        history.update_quality(call_uuid, round(score), reference)
        logger.info("quality for %s: %d%% (%d ref words)",
                    call_uuid, round(score), len(ref_words))
    except Exception:
        logger.exception("quality scoring failed for %s", call_uuid)


def schedule(call_uuid: str) -> None:
    asyncio.get_running_loop().create_task(run_for(call_uuid))
