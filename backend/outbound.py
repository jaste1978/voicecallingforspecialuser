"""Outbound calls via the Vobiz REST API.

Flow: POST make-call with our DID as caller ID and answer_url pointing back
at /vobiz/answer?direction=out. When the callee picks up, that webhook plus
the normal media stream reuse the whole inbound bridge; the call activates
without an accept step because the user initiated it.
"""

import logging
import os

import httpx

logger = logging.getLogger("outbound")

API_BASE = os.environ.get("VOBIZ_API_BASE", "https://api.vobiz.ai/api/v1")


def _creds() -> tuple[str, str] | None:
    auth_id = os.environ.get("VOBIZ_AUTH_ID")
    token = os.environ.get("VOBIZ_AUTH_TOKEN")
    if not auth_id or not token:
        return None
    return auth_id, token


def configured() -> bool:
    return _creds() is not None and bool(os.environ.get("PUBLIC_HOST"))


async def place_call(to_number: str) -> dict:
    """Fire the outbound call. Returns {'request_uuid': ...} on success."""
    creds = _creds()
    host = os.environ.get("PUBLIC_HOST")
    if creds is None or not host:
        raise RuntimeError(
            "Outbound not configured: set VOBIZ_AUTH_ID, VOBIZ_AUTH_TOKEN and PUBLIC_HOST"
        )
    auth_id, token = creds
    from_did = os.environ.get("VOBIZ_DID", "917971442451")
    base = f"https://{host}"
    payload = {
        "from": from_did,
        "to": to_number.lstrip("+").replace(" ", ""),
        "answer_url": f"{base}/vobiz/answer?direction=out",
        "answer_method": "POST",
        "ring_url": f"{base}/vobiz/ring",
        "hangup_url": f"{base}/vobiz/hangup",
    }
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(
            f"{API_BASE}/Account/{auth_id}/Call/",
            json=payload,
            headers={"X-Auth-ID": auth_id, "X-Auth-Token": token},
        )
    if resp.status_code >= 300:
        logger.error("make-call failed %s: %s", resp.status_code, resp.text[:300])
        raise RuntimeError(f"Vobiz make-call failed ({resp.status_code})")
    data = resp.json()
    logger.info("outbound call fired: %s", data)
    return data


async def hangup_call(request_uuid: str) -> None:
    """Best-effort cancel of a not-yet-answered outbound call."""
    creds = _creds()
    if creds is None or not request_uuid:
        return
    auth_id, token = creds
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            await client.delete(
                f"{API_BASE}/Account/{auth_id}/Call/{request_uuid}/",
                headers={"X-Auth-ID": auth_id, "X-Auth-Token": token},
            )
    except Exception:
        logger.exception("outbound hangup failed")
