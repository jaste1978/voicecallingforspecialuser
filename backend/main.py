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

from fastapi import FastAPI, Request, Response, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

import auth
import providers
from vobiz_handler import router as vobiz_router

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("main")


def _request_user(request: Request) -> dict | None:
    header = request.headers.get("authorization", "")
    token = header[7:] if header.lower().startswith("bearer ") else request.query_params.get("token")
    return auth.user_for_token(token)


def _require_user(request: Request) -> dict:
    user = _request_user(request)
    if user is None:
        from fastapi import HTTPException
        raise HTTPException(status_code=401, detail="login required")
    return user


def _require_admin(request: Request) -> dict:
    user = _require_user(request)
    if user.get("role") != "admin":
        from fastapi import HTTPException
        raise HTTPException(status_code=403, detail="admin only")
    return user


def _is_admin_req(request: Request) -> bool:
    admin_key = os.environ.get("ADMIN_KEY")
    if admin_key and request.headers.get("x-admin-key") == admin_key:
        return True
    user = _request_user(request)
    return bool(user and user.get("role") == "admin")

app = FastAPI(title="SunoSathi backend")
app.include_router(vobiz_router)

# Multi-tenant migration: ensure tables exist, then hand pre-tenant rows
# (calls/contacts with no user_id) to the first admin.
import contacts as _contacts  # noqa: E402,F401  (creates table on import)
import number_map as _number_map  # noqa: E402,F401  (creates table on import)
import history as _history  # noqa: E402

_admin_id = auth.first_admin_id()
if _admin_id is not None:
    _history.assign_orphans(_admin_id)

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


@app.post("/api/login")
async def api_login(payload: dict):
    user = auth.verify(payload.get("email", ""), payload.get("password", ""))
    if user is None:
        return Response(status_code=401)
    token = auth.create_session(user["id"])
    logger.info("login: %s", user["email"])
    return {"token": token, "name": user["name"], "role": user["role"], "email": user["email"]}


@app.post("/api/logout")
async def api_logout(request: Request):
    header = request.headers.get("authorization", "")
    if header.lower().startswith("bearer "):
        auth.delete_session(header[7:])
    return {"ok": True}


@app.post("/api/users")
async def api_users_create(payload: dict, request: Request):
    # bootstrap/creation: admin session or the ADMIN_KEY header
    if not _is_admin_req(request):
        return Response(status_code=403)
    email = (payload.get("email") or "").strip()
    password = payload.get("password") or ""
    if "@" not in email or len(password) < 8:
        return Response(status_code=422)
    try:
        uid = auth.create_user(email, password,
                               (payload.get("name") or "").strip(),
                               payload.get("role") or "user")
    except Exception:
        return Response(status_code=409)
    return {"ok": True, "id": uid}


def _fmt_number(raw: str) -> str:
    digits = "".join(c for c in raw if c.isdigit())
    if len(digits) == 12 and digits.startswith("91"):
        return f"+91 {digits[2:7]} {digits[7:]}"
    if len(digits) == 10:
        return f"+91 {digits[:5]} {digits[5:]}"
    return f"+{digits}" if digits else raw


def _did_digits() -> str:
    raw = os.environ.get("VOBIZ_DID", "917971442451")
    return "".join(c for c in raw if c.isdigit())


@app.get("/api/me")
async def api_me(request: Request):
    user = _require_user(request)
    import number_map
    own = number_map.number_for_user(user["id"])
    did = _did_digits()
    return {
        **user,
        # the number callers dial: the user's own forwarded number, or the
        # shared DID until one is registered
        "number": _fmt_number(own) if own else _fmt_number(did),
        "did": _fmt_number(did),
        "forward_code": f"**21*0{did[2:] if did.startswith('91') else did}#",
        "has_own_number": own is not None,
    }


@app.get("/api/prefs")
async def api_prefs_get(request: Request):
    user = _require_user(request)
    import user_prefs
    return user_prefs.get_all(user["id"])


@app.put("/api/prefs")
async def api_prefs_put(payload: dict, request: Request):
    user = _require_user(request)
    import user_prefs
    ALLOWED = {"voice", "type_to_talk"}
    for k, v in payload.items():
        if k in ALLOWED and isinstance(v, str) and len(v) <= 60:
            user_prefs.set(user["id"], k, v)
    return user_prefs.get_all(user["id"])


@app.get("/api/calls")
async def api_calls(request: Request):
    user = _require_user(request)
    import history
    from call_session import normalize_caption_script
    calls = history.list_calls(user_id=user["id"])
    for c in calls:
        # older calls were stored before script normalization existed
        c["transcript"] = [normalize_caption_script(t) for t in c["transcript"]]
    return {"calls": calls}


@app.get("/api/settings")
async def api_settings(request: Request):
    _require_admin(request)
    return providers.describe()


@app.put("/api/settings")
async def api_settings_update(payload: dict, request: Request):
    _require_admin(request)
    ok = True
    for kind in ("stt", "tts"):
        name = payload.get(f"{kind}_provider")
        if name:
            ok = providers.set_active(kind, name) and ok
    if not ok:
        return Response(status_code=422)
    return providers.describe()


@app.post("/api/waitlist")
async def api_waitlist_add(payload: dict, request: Request):
    import waitlist

    name = (payload.get("name") or "").strip()
    email = (payload.get("email") or "").strip()
    if not name or "@" not in email:
        return Response(status_code=422)
    waitlist.add(
        name, email,
        (payload.get("role") or "").strip(),
        (payload.get("org") or "").strip(),
        (payload.get("message") or "").strip(),
    )
    logger.info("waitlist signup: %s <%s> (%s)", name, email, payload.get("role"))
    return {"ok": True}


@app.get("/api/waitlist")
async def api_waitlist_list(request: Request):
    import waitlist

    if not _is_admin_req(request):
        return Response(status_code=403)
    return {"signups": waitlist.list_all()}


@app.get("/api/monitor")
async def api_monitor(request: Request):
    _require_admin(request)
    import history
    import observability
    from call_session import manager

    lines = []
    screens_total = 0
    for line in manager.lines.values():
        screens_total += len(line.browser_sockets)
        lines.append({
            "user_id": line.user_id,
            "screens": len(line.browser_sockets),
            "call_state": line.call.state if line.call else "none",
            "call_from": line.call.from_number if line.call else None,
        })
    active = next((l for l in lines if l["call_state"] not in ("none", "ended")), None)
    return {
        "live": {
            "screens_connected": screens_total,
            "call_state": active["call_state"] if active else "none",
            "call_from": active["call_from"] if active else None,
            "lines": lines,
        },
        "calls": [observability.analyze(c) for c in history.list_calls(30)],
    }


@app.post("/api/providers")
async def api_provider_add(payload: dict, request: Request):
    _require_admin(request)
    ok = providers.add_config(
        payload.get("kind", ""), payload.get("adapter", ""),
        payload.get("label", ""), payload.get("api_key", ""),
        payload.get("model"),
    )
    if not ok:
        return Response(status_code=422)
    return providers.describe()


@app.delete("/api/providers/{config_id}")
async def api_provider_delete(config_id: int, request: Request):
    _require_admin(request)
    providers.delete_config(config_id)
    return providers.describe()


@app.get("/api/contacts")
async def api_contacts_list(request: Request):
    user = _require_user(request)
    import contacts
    return {"contacts": contacts.list_contacts(user_id=user["id"])}


@app.post("/api/contacts")
async def api_contacts_add(payload: dict, request: Request):
    user = _require_user(request)
    import contacts
    name = (payload.get("name") or "").strip()
    number = (payload.get("number") or "").strip()
    if not name or not number:
        return Response(status_code=422)
    return contacts.add_contact(name, number, user_id=user["id"])


@app.delete("/api/contacts/{contact_id}")
async def api_contacts_delete(contact_id: int, request: Request):
    user = _require_user(request)
    import contacts
    contacts.delete_contact(contact_id, user_id=user["id"])
    return {"ok": True}


@app.get("/api/users")
async def api_users_list(request: Request):
    _require_admin(request)
    import number_map
    users = auth.list_users()
    nums = number_map.list_numbers()
    for u in users:
        u["numbers"] = [n for n in nums if n["user_id"] == u["id"]]
    return {"users": users}


# ---------- number -> user routing (admin) ----------

@app.get("/api/numbers")
async def api_numbers_list(request: Request):
    _require_admin(request)
    import number_map
    return {"numbers": number_map.list_numbers()}


@app.post("/api/numbers")
async def api_numbers_add(payload: dict, request: Request):
    _require_admin(request)
    import number_map
    try:
        return number_map.add_number(
            int(payload.get("user_id", 0)),
            str(payload.get("number") or ""),
            str(payload.get("kind") or "forwarded"),
        )
    except Exception as exc:
        logger.warning("add_number rejected: %s", exc)
        return Response(status_code=422)


@app.delete("/api/numbers/{number_id}")
async def api_numbers_delete(number_id: int, request: Request):
    _require_admin(request)
    import number_map
    number_map.delete_number(number_id)
    return {"ok": True}


@app.post("/api/calls/{call_uuid}/rescore")
async def api_call_rescore(call_uuid: str, request: Request):
    _require_admin(request)
    import quality
    score = quality.rescore_stored(call_uuid)
    if score is None:
        return Response(status_code=404)
    return {"quality_score": score}


@app.get("/api/calls/{call_uuid}/audio/{track}")
async def api_call_audio(call_uuid: str, track: str, request: Request):
    user = _require_user(request)
    import history
    import recorder
    from fastapi.responses import FileResponse

    call = history.get_by_uuid(call_uuid)
    owner = call.get("user_id") if call else None
    if user.get("role") != "admin" and owner is not None and owner != user["id"]:
        return Response(status_code=403)
    path = recorder.path_for(call_uuid, track)
    if path is None:
        return Response(status_code=404)
    return FileResponse(path, media_type="audio/wav")


@app.websocket("/ws/stt")
async def ws_stt(ws: WebSocket):
    if auth.user_for_token(ws.query_params.get("token")) is None:
        await ws.close(code=4401)
        return
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
    async def spa(path: str, request: Request):
        host = (request.headers.get("x-forwarded-host")
                or request.headers.get("host", "")).split(":")[0]
        # marketing site at the root of the main domain; the app lives on
        # app.sunosathi.com (and the railway URL) unchanged
        if path == "" and host in ("sunosathi.com", "www.sunosathi.com"):
            return FileResponse(_dist / "welcome.html")
        if path == "robots.txt" and host not in ("sunosathi.com", "www.sunosathi.com"):
            # the app host (and railway URL) should not be crawled at all
            return Response("User-agent: *\nDisallow: /\n", media_type="text/plain")
        if path in ("welcome", "site", "about"):
            return FileResponse(_dist / "welcome.html")
        if path == "ios":
            return FileResponse(_dist / "ios.html")
        candidate = _dist / path
        if path and ".." not in path and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(_dist / "index.html")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=int(os.environ.get("PORT", 8000)))
