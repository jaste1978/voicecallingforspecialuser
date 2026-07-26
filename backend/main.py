"""SunoSathi backend: live-caption STT relay (+ Vobiz call bridge in phase 2).

WS /ws/stt protocol (browser side):
  1. client sends one JSON text frame: {"language": "hi"|"gu"|"en"|"hinglish"|"auto"}
  2. client streams binary frames: raw 16kHz mono pcm_s16le chunks
  3. server sends JSON text frames: transcript / vad / error events (see sarvam_relay)
"""

import json
import logging
import os
from pathlib import Path

from fastapi import FastAPI, Response, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from sarvam_relay import SarvamSTTSession
from vobiz_handler import router as vobiz_router

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("main")

app = FastAPI(title="SunoSathi backend")
app.include_router(vobiz_router)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # dev-friendly; tighten when deployed
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
async def health():
    return {"ok": True}


@app.get("/api/calls")
async def api_calls():
    import history
    return {"calls": history.list_calls()}


@app.get("/api/calls/{call_uuid}/audio/{track}")
async def api_call_audio(call_uuid: str, track: str):
    import recorder
    from fastapi.responses import FileResponse

    path = recorder.path_for(call_uuid, track)
    if path is None:
        return Response(status_code=404)
    return FileResponse(path, media_type="audio/wav")


@app.websocket("/ws/stt")
async def ws_stt(ws: WebSocket):
    await ws.accept()
    session: SarvamSTTSession | None = None

    async def forward(event: dict) -> None:
        try:
            await ws.send_text(json.dumps(event, ensure_ascii=False))
        except Exception:
            pass

    try:
        # First frame must be the JSON config
        config_raw = await ws.receive_text()
        config = json.loads(config_raw)
        language = config.get("language", "auto")
        sample_rate = int(config.get("sample_rate", 16000))

        session = SarvamSTTSession(language, forward, sample_rate=sample_rate)
        await session.start()
        await forward({"type": "ready", "language": language})

        while True:
            frame = await ws.receive()
            if frame.get("type") == "websocket.disconnect":
                break
            if frame.get("bytes"):
                await session.send_pcm(frame["bytes"])
            elif frame.get("text"):
                msg = json.loads(frame["text"])
                if msg.get("type") == "flush" and session._ws is not None:
                    await session._ws.flush()
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("/ws/stt failed")
        await forward({"type": "error", "message": "server error"})
    finally:
        if session:
            await session.close()


# Serve the built frontend when frontend/dist exists (single-service deploy).
# Unknown paths fall back to index.html so SPA routes survive reloads.
_dist = Path(__file__).resolve().parent.parent / "frontend" / "dist"
if _dist.is_dir():
    from fastapi.responses import FileResponse

    app.mount("/assets", StaticFiles(directory=_dist / "assets"), name="assets")

    @app.get("/{path:path}")
    async def spa(path: str):
        candidate = _dist / path
        if path and ".." not in path and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(_dist / "index.html")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=int(os.environ.get("PORT", 8000)))
