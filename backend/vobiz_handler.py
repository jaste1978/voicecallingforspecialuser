"""Vobiz webhook + media-stream websocket endpoints."""

import json
import logging
import os

from fastapi import APIRouter, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import Response

from call_session import manager

logger = logging.getLogger("vobiz")

router = APIRouter()


def _public_host(request: Request) -> str:
    """Host Vobiz should connect back to (tunnel/deploy hostname)."""
    return (
        os.environ.get("PUBLIC_HOST")
        or request.headers.get("x-forwarded-host")
        or request.headers.get("host", "localhost:8000")
    )


@router.api_route("/vobiz/answer", methods=["GET", "POST"])
async def vobiz_answer(request: Request):
    params = dict(request.query_params)
    if request.method == "POST":
        body = (await request.body()).decode("utf-8", "replace")
        if body:
            try:
                params.update(json.loads(body))
            except json.JSONDecodeError:
                from urllib.parse import parse_qs
                params.update({k: v[0] for k, v in parse_qs(body).items()})

    call_uuid = params.get("CallUUID") or params.get("CallSid") or "unknown"
    from_number = params.get("From") or "Unknown caller"
    to_number = params.get("To") or ""
    logger.info("incoming call %s from %s to %s", call_uuid, from_number, to_number)

    if request.query_params.get("direction") == "out":
        # Callee answered our outbound call: reuse the same media bridge
        if await manager.outbound_answered(call_uuid):
            ws_url = f"wss://{_public_host(request)}/ws/vobiz"
            xml = f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Stream
        bidirectional="true"
        audioTrack="inbound"
        contentType="audio/x-l16;rate=16000"
        keepCallAlive="true"
        maxRetries="3"
        streamTimeout="3600">{ws_url}</Stream>
</Response>"""
            return Response(content=xml, media_type="application/xml")
        logger.warning("outbound answer webhook with no dialing call — hanging up")
        return Response(
            content='<?xml version="1.0" encoding="UTF-8"?>\n<Response><Hangup/></Response>',
            media_type="application/xml",
        )

    # Vobiz re-fetches the Answer URL when our stream closes on a call we
    # already ended (keepCallAlive). Hang the call up instead of re-ringing.
    if manager.was_recently_ended(call_uuid):
        logger.info("call %s already ended — sending Hangup", call_uuid)
        return Response(
            content='<?xml version="1.0" encoding="UTF-8"?>\n<Response><Hangup/></Response>',
            media_type="application/xml",
        )

    await manager.register_pending(call_uuid, from_number, to_number)

    ws_url = f"wss://{_public_host(request)}/ws/vobiz"
    xml = f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Stream
        bidirectional="true"
        audioTrack="inbound"
        contentType="audio/x-l16;rate=16000"
        keepCallAlive="true"
        maxRetries="3"
        streamTimeout="3600">{ws_url}</Stream>
</Response>"""
    return Response(content=xml, media_type="application/xml")


@router.api_route("/vobiz/ring", methods=["GET", "POST"])
async def vobiz_ring(request: Request):
    await manager.outbound_ringing()
    return Response(content="OK")


@router.api_route("/vobiz/hangup", methods=["GET", "POST"])
async def vobiz_hangup(request: Request):
    params = dict(request.query_params)
    if request.method == "POST":
        body = (await request.body()).decode("utf-8", "replace")
        if body:
            try:
                params.update(json.loads(body))
            except json.JSONDecodeError:
                from urllib.parse import parse_qs
                params.update({k: v[0] for k, v in parse_qs(body).items()})
    cause = params.get("HangupCause") or params.get("HangupReason") or "call ended"
    logger.info("vobiz hangup callback: %s", cause)
    await manager.vobiz_hangup_event(str(cause))
    return Response(content="OK")


@router.websocket("/ws/vobiz")
async def ws_vobiz(ws: WebSocket):
    await ws.accept()
    logger.info("vobiz stream websocket connected")
    try:
        while True:
            raw = await ws.receive_text()
            msg = json.loads(raw)
            event = msg.get("event")
            if event == "start":
                await manager.vobiz_stream_started(ws, msg.get("start", msg))
            elif event == "media":
                payload = (msg.get("media") or {}).get("payload")
                if payload:
                    await manager.vobiz_media(payload)
            elif event == "stop":
                logger.info("vobiz sent stop")
                break
            # playedStream / clearedAudio acks are ignored
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("vobiz websocket error")
    finally:
        await manager.vobiz_disconnected(ws)
        logger.info("vobiz stream websocket closed")


@router.websocket("/ws/call")
async def ws_call(ws: WebSocket):
    """The user's browser: receives ring/captions/caller-audio, sends accept/end + mic PCM."""
    import auth
    if auth.user_for_token(ws.query_params.get("token")) is None:
        await ws.close(code=4401)
        return
    await ws.accept()
    await manager.browser_connected(ws)
    try:
        while True:
            frame = await ws.receive()
            if frame.get("type") == "websocket.disconnect":
                break
            if frame.get("bytes"):
                await manager.on_browser_audio(frame["bytes"])
            elif frame.get("text"):
                try:
                    msg = json.loads(frame["text"])
                except json.JSONDecodeError:
                    continue
                if msg.get("type") == "ping":
                    await ws.send_text('{"type": "pong"}')
                else:
                    await manager.on_browser_message(msg)
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("browser call websocket error")
    finally:
        manager.browser_disconnected(ws)
