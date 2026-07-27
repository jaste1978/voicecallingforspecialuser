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

import providers
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


_version_file = Path(__file__).resolve().parent.parent / "VERSION"
APP_VERSION = _version_file.read_text().strip() if _version_file.is_file() else "dev"


@app.get("/api/health")
async def health():
    return {"ok": True, "version": APP_VERSION}


@app.get("/api/calls")
async def api_calls():
    import history
    return {"calls": history.list_calls()}


@app.get("/api/settings")
async def api_settings():
    return providers.describe()


@app.put("/api/settings")
async def api_settings_update(payload: dict):
    ok = True
    for kind in ("stt", "tts"):
        name = payload.get(f"{kind}_provider")
        if name:
            ok = providers.set_active(kind, name) and ok
    if not ok:
        return Response(status_code=422)
    return providers.describe()


@app.get("/api/monitor")
async def api_monitor():
    import history
    import observability
    from call_session import manager

    call = manager.call
    return {
        "live": {
            "screens_connected": len(manager.browser_sockets),
            "call_state": call.state if call else "none",
            "call_from": call.from_number if call else None,
        },
        "calls": [observability.analyze(c) for c in history.list_calls(30)],
    }


@app.post("/api/providers")
async def api_provider_add(payload: dict):
    ok = providers.add_config(
        payload.get("kind", ""), payload.get("adapter", ""),
        payload.get("label", ""), payload.get("api_key", ""),
        payload.get("model"),
    )
    if not ok:
        return Response(status_code=422)
    return providers.describe()


@app.delete("/api/providers/{config_id}")
async def api_provider_delete(config_id: int):
    providers.delete_config(config_id)
    return providers.describe()


@app.get("/api/contacts")
async def api_contacts_list():
    import contacts
    return {"contacts": contacts.list_contacts()}


@app.post("/api/contacts")
async def api_contacts_add(payload: dict):
    import contacts
    name = (payload.get("name") or "").strip()
    number = (payload.get("number") or "").strip()
    if not name or not number:
        return Response(status_code=422)
    return contacts.add_contact(name, number)


@app.delete("/api/contacts/{contact_id}")
async def api_contacts_delete(contact_id: int):
    import contacts
    contacts.delete_contact(contact_id)
    return {"ok": True}


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
    session = None

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

        session = providers.get_stt(language).create_session(
            language, forward, sample_rate=sample_rate
        )
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
                # provider-specific manual flush (supported by Sarvam sessions)
                inner_ws = getattr(session, "_ws", None)
                if msg.get("type") == "flush" and inner_ws is not None:
                    await inner_ws.flush()
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
