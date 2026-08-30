"""One-tap onboarding test call.

The user taps "Try a test call" in the app; we ring their own SunoSathi
line and speak a short Hindi greeting so they watch live captions appear —
no second phone, no helper needed. Reuses the exact production path the
sentinel exercises nightly: register pending call -> /ws/vobiz stream ->
ring -> accept -> captions.
"""

import asyncio
import base64
import json
import logging
import os
import time

import websockets

logger = logging.getLogger("test_call")

FRAME = 640  # 20ms of 16kHz mono 16-bit PCM
SILENCE_1S = b"\x00" * 32000

GREETING = (
    "नमस्ते! यह सुनोसाथी की टेस्ट कॉल है। "
    "जो मैं बोल रही हूँ, वह आपको लिखा हुआ दिख रहा है। "
    "इसी तरह हर कॉल में आप अपने कॉलर की बात पढ़ पाएँगे। "
    "आप बोलकर, टाइप करके, या पिक्चर दबाकर जवाब दे सकते हैं। "
    "बधाई हो! आपका सुनोसाथी बिल्कुल तैयार है।"
)


def _ws_base() -> str:
    return f"ws://127.0.0.1:{os.environ.get('PORT', '8000')}"


async def run(user_id: int, call_uuid: str) -> None:
    """Caller side of the test call. Registered on the line by the API
    endpoint before this task starts; here we just stream like Vobiz would."""
    import speech

    try:
        pcm = await speech.speak_pcm(GREETING)
        if not pcm:
            logger.warning("test call %s: TTS empty — aborting", call_uuid)
            return

        ws = await websockets.connect(f"{_ws_base()}/ws/vobiz")
        await ws.send(json.dumps({"event": "start", "start": {
            "streamId": f"st-{call_uuid}", "callId": call_uuid,
            "mediaFormat": {"encoding": "audio/x-l16", "sampleRate": 16000}}}))

        async def drain():
            try:
                while True:
                    await ws.recv()
            except Exception:
                pass

        drainer = asyncio.get_event_loop().create_task(drain())

        async def send(buf: bytes):
            for i in range(0, len(buf), FRAME):
                await ws.send(json.dumps({"event": "media", "media": {
                    "payload": base64.b64encode(buf[i:i + FRAME]).decode()}}))
                await asyncio.sleep(0.02)

        def call_state() -> str:
            from call_session import manager
            line = manager.lines.get(user_id)
            call = line.call if line else None
            if call is None or call.call_uuid != call_uuid:
                return "gone"
            return call.state

        try:
            # ring, sending silence, until the user accepts (max 40s)
            for _ in range(40):
                state = call_state()
                if state == "active":
                    break
                if state in ("gone", "ended"):
                    logger.info("test call %s: not accepted", call_uuid)
                    return
                await send(SILENCE_1S)
            else:
                logger.info("test call %s: ring timeout", call_uuid)
                return
            # small beat after accept, then the greeting they came to see
            await send(SILENCE_1S * 2)
            await send(pcm)
            # linger so captions finalize and the user can try type-to-speak
            for _ in range(25):
                if call_state() != "active":
                    break
                await send(SILENCE_1S)
            logger.info("test call %s finished", call_uuid)
        except websockets.exceptions.ConnectionClosed:
            logger.info("test call %s: call ended by user", call_uuid)
        finally:
            drainer.cancel()
            try:
                await ws.close()
            except Exception:
                pass
    except Exception:
        logger.exception("test call %s failed", call_uuid)


def start(user_id: int) -> str:
    """Create the pending call on the user's line and launch the caller task.
    Returns the call uuid. Must be awaited-registered by the caller first."""
    return f"test-{user_id}-{int(time.time())}"
