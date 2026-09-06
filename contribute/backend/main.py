"""ISL contribution platform — API.

Track C. A public place where signers record ISL phrase by phrase, so that
Track B's text→pose model has real data to learn from. Deployed as its own
Railway service at contribute.sunosathi.com; it shares the repo with the
main app and nothing else — no shared database, no shared process.

The submit path is deliberately split in two:

    POST /api/contributions      keypoints saved, upload URL handed back
    PUT  <presigned R2 url>      browser sends the video straight to R2
    POST /api/contributions/:id/video   we confirm the object landed

so that a contributor on a weak connection who loses the video upload has
still contributed the thing we actually train on. Losing 4MB of video is an
inconvenience; losing the keypoints would mean asking them to sign again.
"""

import logging
import os
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Header, Request, Response
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles

import consent
import db
import storage

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("contribute")


@asynccontextmanager
async def lifespan(_: FastAPI):
    db.init()
    with db.conn() as c:
        n = c.execute("SELECT COUNT(*) FROM phrases").fetchone()[0]
    logger.info("db ready at %s — %d phrases, R2 %s", db.DB_PATH, n,
                "configured" if storage.configured() else "NOT configured (videos skipped)")
    yield


app = FastAPI(title="SunoSathi — ISL contributions", docs_url=None, redoc_url=None,
              lifespan=lifespan)

MAX_FRAMES = 2000        # ~80s at 25fps; a phrase take is 3–5s
MAX_DURATION_MS = 30_000
POSE_FORMAT = 2          # keep in step with frontend/src/lib/sign/poseFormat.ts


# ---- helpers ---------------------------------------------------------------

def _admin_ok(key: str | None) -> bool:
    want = os.environ.get("ADMIN_KEY", "")
    return bool(want) and key == want


async def _turnstile_ok(payload: dict, request: Request) -> bool:
    """Cloudflare Turnstile on public submits. No-op until TURNSTILE_SECRET
    is set, so a laptop and a phone on the LAN can both run the flow."""
    secret = os.environ.get("TURNSTILE_SECRET")
    if not secret:
        return True
    token = payload.get("turnstile") or payload.get("cf-turnstile-response") or ""
    if not token:
        return False
    try:
        import httpx
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.post(
                "https://challenges.cloudflare.com/turnstile/v0/siteverify",
                data={"secret": secret, "response": token,
                      "remoteip": request.client.host if request.client else ""},
            )
        return bool(r.json().get("success"))
    except Exception:
        logger.exception("turnstile verify error")
        return True  # fail open: a Cloudflare outage must not stop a signer


def _client_note(request: Request) -> str:
    """Enough to tell an iPhone take from an Android one when a batch of
    clips turns out badly tracked. Not a fingerprint — no IP is stored."""
    return (request.headers.get("user-agent") or "")[:180]


# ---- consent ---------------------------------------------------------------

@app.get("/api/consent-text")
def api_consent_text():
    return consent.document()


@app.post("/api/consent")
def api_consent(payload: dict, request: Request):
    device_id = str(payload.get("device_id") or "").strip()[:64]
    if not device_id:
        return JSONResponse({"error": "device_id required"}, status_code=422)

    checks = payload.get("checks") or {}
    if not (checks.get("agree") and checks.get("adult")):
        return JSONResponse({"error": "consent not given"}, status_code=422)

    name = str(payload.get("display_name") or "").strip()[:80]
    contact = str(payload.get("contact") or "").strip()[:120]
    credit = 1 if checks.get("credit") else 0
    lang = str(payload.get("lang") or "hi")[:5]

    with db.conn() as c:
        row = c.execute(
            "SELECT id FROM contributors WHERE device_id = ? ORDER BY created_at LIMIT 1",
            (device_id,),
        ).fetchone()
        if row:
            contributor_id = row["id"]
            c.execute(
                "UPDATE contributors SET display_name = ?, contact = ?, credit_optin = ?"
                " WHERE id = ?", (name, contact, credit, contributor_id),
            )
        else:
            contributor_id = db.new_id("c")
            c.execute(
                "INSERT INTO contributors (id, device_id, display_name, contact, credit_optin)"
                " VALUES (?, ?, ?, ?, ?)",
                (contributor_id, device_id, name, contact, credit),
            )

        consent_id = db.new_id("k")
        c.execute(
            "INSERT INTO consents (id, contributor_id, version, text_hash, lang,"
            " credit_optin, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (consent_id, contributor_id, consent.VERSION, consent.text_hash(),
             lang, credit, _client_note(request)),
        )

    return {"contributor_id": contributor_id, "consent_id": consent_id,
            "version": consent.VERSION}


# ---- phrases ---------------------------------------------------------------

@app.get("/api/phrases")
def api_phrases(contributor_id: str = "", limit: int = 20):
    """The queue, neediest first.

    A phrase this contributor has already recorded drops to the back rather
    than out: one person signing the same phrase twice is far less useful
    than two people signing it once, but on a pilot with three contributors
    a second take still beats no take."""
    limit = max(1, min(limit, 100))
    with db.conn() as c:
        rows = c.execute(
            """
            WITH counts AS (
                SELECT phrase_id,
                       SUM(CASE WHEN review_status != 'rejected' THEN 1 ELSE 0 END) AS have,
                       SUM(CASE WHEN contributor_id = ? THEN 1 ELSE 0 END) AS mine
                  FROM contributions
                 WHERE deleted_at IS NULL
                 GROUP BY phrase_id
            )
            SELECT p.*, COALESCE(n.have, 0) AS have, COALESCE(n.mine, 0) AS mine
              FROM phrases p
              LEFT JOIN counts n ON n.phrase_id = p.id
             WHERE p.active = 1
             ORDER BY (COALESCE(n.mine, 0) > 0) ASC,
                      (CAST(COALESCE(n.have, 0) AS REAL) / MAX(p.target_count, 1)) ASC,
                      p.tier ASC, p.sort ASC
             LIMIT ?
            """,
            (contributor_id, limit),
        ).fetchall()
    return {"phrases": [dict(r) for r in rows]}


# ---- contributions ---------------------------------------------------------

@app.post("/api/contributions")
async def api_contribute(payload: dict, request: Request):
    if not await _turnstile_ok(payload, request):
        return JSONResponse({"error": "verification failed"}, status_code=403)

    phrase_id = str(payload.get("phrase_id") or "")[:80]
    contributor_id = str(payload.get("contributor_id") or "")[:64]
    consent_id = str(payload.get("consent_id") or "")[:64]
    frames = payload.get("frames")

    if not isinstance(frames, list) or not frames:
        return JSONResponse({"error": "no keypoints"}, status_code=422)
    if len(frames) > MAX_FRAMES:
        return JSONResponse({"error": "clip too long"}, status_code=413)

    duration_ms = int(payload.get("duration_ms") or 0)
    if duration_ms <= 0 or duration_ms > MAX_DURATION_MS:
        return JSONResponse({"error": "bad duration"}, status_code=422)

    with db.conn() as c:
        if not c.execute("SELECT 1 FROM phrases WHERE id = ?", (phrase_id,)).fetchone():
            return JSONResponse({"error": "unknown phrase"}, status_code=404)
        ok = c.execute(
            "SELECT 1 FROM consents WHERE id = ? AND contributor_id = ?"
            " AND withdrawn_at IS NULL", (consent_id, contributor_id),
        ).fetchone()
        # No consent, no clip. This is the one check that must never be
        # relaxed for convenience.
        if not ok:
            return JSONResponse({"error": "consent required"}, status_code=403)

        cov = payload.get("coverage") or {}
        blob = db.pack_keypoints(frames)
        cid = db.new_id("s")

        mime = str(payload.get("video_mime") or "")[:60]
        key = storage.object_key(phrase_id, cid, mime) if mime else ""
        upload_url = storage.presign_put(key, mime) if key else None
        status = "pending" if upload_url else ("skipped" if mime else "none")
        if not upload_url:
            key = ""

        c.execute(
            """INSERT INTO contributions
                   (id, phrase_id, contributor_id, consent_id, pose_format, fps,
                    duration_ms, frame_count, cov_body, cov_face, cov_hand_l,
                    cov_hand_r, keypoints, keypoints_bytes, video_key, video_mime,
                    video_status, client)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (cid, phrase_id, contributor_id, consent_id, POSE_FORMAT,
             float(payload.get("fps") or 0), duration_ms, len(frames),
             float(cov.get("body") or 0), float(cov.get("face") or 0),
             float(cov.get("handL") or 0), float(cov.get("handR") or 0),
             blob, len(blob), key, mime, status, _client_note(request)),
        )

    return {"id": cid, "upload_url": upload_url, "video_key": key,
            "video_status": status, "keypoints_bytes": len(blob)}


@app.post("/api/contributions/{cid}/video")
def api_contribute_video(cid: str, payload: dict):
    """Called after the browser's PUT. We verify against R2 rather than
    trusting the report — a video the bucket does not have is not a video."""
    with db.conn() as c:
        row = c.execute(
            "SELECT video_key, video_status FROM contributions WHERE id = ?", (cid,),
        ).fetchone()
        if not row:
            return JSONResponse({"error": "unknown contribution"}, status_code=404)

        if not payload.get("ok"):
            c.execute("UPDATE contributions SET video_status = 'failed' WHERE id = ?", (cid,))
            return {"video_status": "failed"}

        info = storage.head(row["video_key"]) if row["video_key"] else None
        if info:
            c.execute(
                "UPDATE contributions SET video_status = 'stored', video_bytes = ?"
                " WHERE id = ?", (info["bytes"], cid),
            )
            return {"video_status": "stored", "bytes": info["bytes"]}

        c.execute("UPDATE contributions SET video_status = 'failed' WHERE id = ?", (cid,))
        return {"video_status": "failed"}


@app.get("/api/me")
def api_me(contributor_id: str = ""):
    """Progress for the encouragement line. Rejected clips still count here:
    a person who showed up and signed did contribute, and telling them
    otherwise would be both discouraging and beside the point."""
    if not contributor_id:
        return {"total": 0, "today": 0, "phrases": 0}
    day_start = time.time() - (time.time() % 86400)
    with db.conn() as c:
        r = c.execute(
            "SELECT COUNT(*) AS total,"
            " COUNT(DISTINCT phrase_id) AS phrases,"
            " SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS today"
            " FROM contributions WHERE contributor_id = ? AND deleted_at IS NULL",
            (day_start, contributor_id),
        ).fetchone()
    return {"total": r["total"] or 0, "today": r["today"] or 0,
            "phrases": r["phrases"] or 0}


@app.get("/api/stats")
def api_stats():
    """Public counter for the landing page — the community's own scoreboard."""
    with db.conn() as c:
        r = c.execute(
            "SELECT COUNT(*) AS clips, COUNT(DISTINCT contributor_id) AS people,"
            " COUNT(DISTINCT phrase_id) AS phrases FROM contributions"
            " WHERE deleted_at IS NULL",
        ).fetchone()
        total = c.execute("SELECT COUNT(*) FROM phrases WHERE active = 1").fetchone()[0]
    return {"clips": r["clips"], "people": r["people"], "phrases_covered": r["phrases"],
            "phrases_total": total}


# ---- admin -----------------------------------------------------------------

@app.get("/api/admin/stats")
def api_admin_stats(x_admin_key: str | None = Header(None)):
    if not _admin_ok(x_admin_key):
        return Response(status_code=401)
    with db.conn() as c:
        by_status = {r["review_status"]: r["n"] for r in c.execute(
            "SELECT review_status, COUNT(*) AS n FROM contributions"
            " WHERE deleted_at IS NULL GROUP BY review_status")}
        by_video = {r["video_status"]: r["n"] for r in c.execute(
            "SELECT video_status, COUNT(*) AS n FROM contributions"
            " WHERE deleted_at IS NULL GROUP BY video_status")}
        size = c.execute(
            "SELECT COALESCE(SUM(keypoints_bytes), 0) AS kp,"
            " COALESCE(SUM(video_bytes), 0) AS vid FROM contributions").fetchone()
        need = c.execute(
            """SELECT p.id, p.hi, p.gloss, p.target_count,
                      (SELECT COUNT(*) FROM contributions x WHERE x.phrase_id = p.id
                        AND x.deleted_at IS NULL AND x.review_status != 'rejected') AS have
                 FROM phrases p WHERE p.active = 1
                ORDER BY have ASC, p.tier ASC, p.sort ASC LIMIT 15""").fetchall()
    return {"review": by_status, "video": by_video,
            "keypoint_bytes": size["kp"], "video_bytes": size["vid"],
            "r2": storage.configured(), "consent_version": consent.VERSION,
            "most_needed": [dict(r) for r in need]}


@app.get("/api/admin/export.jsonl")
def api_admin_export(x_admin_key: str | None = Header(None),
                     review_status: str = "", limit: int = 5000):
    """The handover format, exactly as agreed with Track B in the brief.

    Defaults to everything not deleted so the pilot can be inspected before
    review exists; pass ?review_status=approved once M2 is running and this
    becomes the training export."""
    if not _admin_ok(x_admin_key):
        return Response(status_code=401)

    sql = ("SELECT c.*, p.gloss, p.hi, p.en FROM contributions c"
           " JOIN phrases p ON p.id = c.phrase_id"
           " WHERE c.deleted_at IS NULL")
    args: list = []
    if review_status:
        sql += " AND c.review_status = ?"
        args.append(review_status)
    sql += " ORDER BY c.created_at LIMIT ?"
    args.append(max(1, min(limit, 50000)))

    import json as _json

    def rows():
        with db.conn() as c:
            for r in c.execute(sql, args):
                yield _json.dumps({
                    "phrase_id": r["phrase_id"],
                    "gloss": r["gloss"],
                    "text": {"hi": r["hi"], "en": r["en"]},
                    "contributor_id": r["contributor_id"],
                    "consent_id": r["consent_id"],
                    "review_status": r["review_status"],
                    "variant_tag": r["variant_tag"],
                    "format": r["pose_format"],
                    "fps": r["fps"],
                    "duration_ms": r["duration_ms"],
                    "coverage": {"body": r["cov_body"], "face": r["cov_face"],
                                 "handL": r["cov_hand_l"], "handR": r["cov_hand_r"]},
                    "video_key": r["video_key"] or None,
                    "keypoints": db.unpack_keypoints(r["keypoints"]),
                }, separators=(",", ":")) + "\n"

    return PlainTextResponse("".join(rows()), media_type="application/x-ndjson")


@app.get("/api/health")
def api_health():
    return {"ok": True, "r2": storage.configured(),
            "consent_version": consent.VERSION, "pose_format": POSE_FORMAT}


# ---- static site -----------------------------------------------------------

DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"
if DIST.is_dir():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/{path:path}")
    def spa(path: str):
        if path.startswith("api/"):
            return Response(status_code=404)
        candidate = DIST / path
        if path and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(DIST / "index.html")
