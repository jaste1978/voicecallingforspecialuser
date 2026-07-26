"""Per-call audio recording (16kHz mono WAV) for diagnosing STT/TTS issues.

Two tracks per call: 'caller' (exactly what was fed to Sarvam STT) and
'user' (mic + TTS prompts, i.e. what the caller heard).
"""

import logging
import os
import wave
from pathlib import Path

logger = logging.getLogger("recorder")

REC_DIR = Path(os.environ.get("RECORDINGS_DIR",
                              Path(__file__).resolve().parent / "recordings"))
REC_DIR.mkdir(parents=True, exist_ok=True)

KEEP_FILES = 200  # ~100 calls; oldest recordings pruned beyond this


class CallRecorder:
    def __init__(self, call_uuid: str):
        self.call_uuid = call_uuid
        self._files: dict[str, wave.Wave_write] = {}

    def write(self, track: str, pcm: bytes) -> None:
        w = self._files.get(track)
        if w is None:
            path = REC_DIR / f"{self.call_uuid}_{track}.wav"
            w = wave.open(str(path), "wb")
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(16000)
            self._files[track] = w
        w.writeframes(pcm)

    def close(self) -> None:
        for w in self._files.values():
            try:
                w.close()
            except Exception:
                pass
        self._files.clear()
        prune()


def path_for(call_uuid: str, track: str) -> Path | None:
    if track not in ("caller", "user"):
        return None
    p = REC_DIR / f"{call_uuid}_{track}.wav"
    return p if p.is_file() else None


def prune(keep: int = KEEP_FILES) -> None:
    try:
        files = sorted(REC_DIR.glob("*.wav"), key=lambda p: p.stat().st_mtime)
        for p in files[:-keep] if len(files) > keep else []:
            p.unlink(missing_ok=True)
            logger.info("pruned old recording %s", p.name)
    except Exception:
        logger.exception("prune failed")
