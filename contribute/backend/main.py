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
import sqlite3
import time
from contextlib import asynccontextmanager
from pathlib import Path


def _load_env_file() -> None:
    """Read backend/.env into the environment for local runs.

    Railway injects real variables, so anything already set always wins and
    this is a no-op in production. The file is gitignored: it is where an R2
    key or an admin password lives on a laptop, instead of in a committed
    launch config.
    """
    path = Path(__file__).with_name(".env")
    if not path.exists():
        return
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip("'\""))


_load_env_file()

from fastapi import FastAPI, Header, Request, Response
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles

import auth
import consent
import db
import storage
import telegram

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("contribute")


@asynccontextmanager
async def lifespan(_: FastAPI):
    db.init()
    auth.ensure_admin()
    with db.conn() as c:
        n = c.execute("SELECT COUNT(*) FROM phrases").fetchone()[0]
        admins = c.execute("SELECT COUNT(*) FROM users WHERE role = 'admin'").fetchone()[0]
    logger.info("db ready at %s — %d phrases, %d admin(s), access=%s, R2 %s",
                db.DB_PATH, n, admins, db.ACCESS_MODE,
                "configured" if storage.configured() else "NOT configured (videos skipped)")
    if admins == 0:
        logger.warning("no admin account — set ADMIN_EMAIL and ADMIN_PASSWORD")
    yield


app = FastAPI(title="SunoSathi — ISL contributions", docs_url=None, redoc_url=None,
              lifespan=lifespan)

MAX_FRAMES = 2000        # ~80s at 25fps; a phrase take is 3–5s
MAX_DURATION_MS = 30_000
POSE_FORMAT = 2          # keep in step with frontend/src/lib/sign/poseFormat.ts


# ---- helpers ---------------------------------------------------------------

def _admin_key_ok(key: str | None) -> bool:
    """The scripted way in — used by the dataset export, which Track B runs
    from a shell and not from a browser."""
    want = os.environ.get("ADMIN_KEY", "")
    return bool(want) and key == want


def current_user(request: Request) -> dict | None:
    return auth.user_for_token(request.cookies.get(auth.SESSION_COOKIE, ""))


def _is_admin(request: Request, key: str | None = None) -> bool:
    if _admin_key_ok(key):
        return True
    u = current_user(request)
    return bool(u and u["role"] == "admin" and u["status"] == "approved")


def _public_user(u: dict) -> dict:
    return {
        "id": u["id"],
        "name": u["display_name"],
        "identifier": u["identifier"],
        "role": u["role"],
        "status": u["status"],
        "credit_optin": bool(u["credit_optin"]),
    }


def _set_session_cookie(response: Response, token: str, request: Request) -> None:
    response.set_cookie(
        auth.SESSION_COOKIE, token,
        max_age=auth.SESSION_DAYS * 86400,
        httponly=True,          # a stolen session should need the browser, not a script
        samesite="lax",
        # Set only over TLS in production; a `secure` cookie on plain http
        # would silently never be stored, which is a confusing way to make
        # local development impossible.
        secure=request.url.scheme == "https",
        path="/",
    )


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


# ---- accounts --------------------------------------------------------------

@app.get("/api/auth/me")
def api_auth_me(request: Request):
    u = current_user(request)
    if not u:
        return JSONResponse({"user": None, "access_mode": db.ACCESS_MODE}, status_code=200)
    return {"user": _public_user(u), "access_mode": db.ACCESS_MODE}


@app.post("/api/auth/register")
async def api_register(payload: dict, request: Request):
    if not await _turnstile_ok(payload, request):
        return JSONResponse({"error": "verification failed"}, status_code=403)

    name = str(payload.get("name") or "").strip()[:80]
    raw = str(payload.get("identifier") or "")
    password = str(payload.get("password") or "")
    note = str(payload.get("note") or "").strip()[:500]

    if len(name) < 2:
        return JSONResponse({"error": "name required"}, status_code=422)
    identifier = auth.normalise_identifier(raw)
    if not auth.identifier_ok(identifier):
        return JSONResponse({"error": "enter a valid email or phone number"},
                            status_code=422)
    if len(password) < auth.MIN_PASSWORD:
        return JSONResponse(
            {"error": f"password must be at least {auth.MIN_PASSWORD} characters"},
            status_code=422)

    # Open mode is how this becomes a public platform again once the pilot is
    # over: same code path, no waiting room.
    status = "approved" if db.ACCESS_MODE == "open" else "pending"
    uid = db.new_id("u")

    with db.conn() as c:
        if c.execute("SELECT 1 FROM users WHERE identifier = ?", (identifier,)).fetchone():
            return JSONResponse({"error": "an account with this already exists"},
                                status_code=409)
        c.execute(
            "INSERT INTO users (id, identifier, display_name, password_hash, role,"
            " status, note, approved_at) VALUES (?, ?, ?, ?, 'contributor', ?, ?, ?)",
            (uid, identifier, name, auth.hash_password(password), status, note,
             time.time() if status == "approved" else None),
        )

    token = auth.start_session(uid, _client_note(request))
    body = {"user": {"id": uid, "name": name, "identifier": identifier,
                     "role": "contributor", "status": status, "credit_optin": False},
            "access_mode": db.ACCESS_MODE}
    response = JSONResponse(body)
    _set_session_cookie(response, token, request)

    if status == "pending":
        await telegram.send(
            f"<b>New ISL contributor waiting</b>\n{name} · {identifier}"
            + (f"\n<i>{note}</i>" if note else "")
            + "\n\nApprove at contribute.sunosathi.com/admin")
    return response


@app.post("/api/auth/login")
async def api_login(payload: dict, request: Request):
    identifier = auth.normalise_identifier(str(payload.get("identifier") or ""))
    password = str(payload.get("password") or "")

    if auth.locked_out(identifier):
        return JSONResponse({"error": "too many attempts — try again later"},
                            status_code=429)

    with db.conn() as c:
        row = c.execute("SELECT * FROM users WHERE identifier = ?",
                        (identifier,)).fetchone()

    # Same message either way: which half was wrong is not the guesser's
    # business, and it is how you keep a login from confirming who has an
    # account here.
    if not row or not auth.verify_password(password, row["password_hash"] or ""):
        auth.note_failure(identifier)
        return JSONResponse({"error": "wrong login or password"}, status_code=401)

    if row["status"] in ("rejected", "suspended"):
        return JSONResponse({"error": "this account cannot sign in"}, status_code=403)

    auth.clear_failures(identifier)
    token = auth.start_session(row["id"], _client_note(request))
    response = JSONResponse({"user": _public_user(dict(row)),
                             "access_mode": db.ACCESS_MODE})
    _set_session_cookie(response, token, request)
    return response


@app.post("/api/auth/logout")
def api_logout(request: Request):
    auth.end_session(request.cookies.get(auth.SESSION_COOKIE, ""))
    response = JSONResponse({"ok": True})
    response.delete_cookie(auth.SESSION_COOKIE, path="/")
    return response


# ---- consent ---------------------------------------------------------------

@app.get("/api/consent-text")
def api_consent_text():
    return consent.document()


@app.post("/api/consent")
def api_consent(payload: dict, request: Request):
    u = current_user(request)
    if not u:
        return JSONResponse({"error": "sign in first"}, status_code=401)
    if u["status"] != "approved":
        return JSONResponse({"error": "account not approved yet"}, status_code=403)

    checks = payload.get("checks") or {}
    if not (checks.get("agree") and checks.get("adult")):
        return JSONResponse({"error": "consent not given"}, status_code=422)

    credit = 1 if checks.get("credit") else 0
    lang = str(payload.get("lang") or "hi")[:5]
    contact = str(payload.get("contact") or "").strip()[:120]

    with db.conn() as c:
        c.execute("UPDATE users SET credit_optin = ?, contact = ? WHERE id = ?",
                  (credit, contact or u["identifier"], u["id"]))
        consent_id = db.new_id("k")
        c.execute(
            "INSERT INTO consents (id, contributor_id, version, text_hash, lang,"
            " credit_optin, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (consent_id, u["id"], consent.VERSION, consent.text_hash(),
             lang, credit, _client_note(request)),
        )

    return {"contributor_id": u["id"], "consent_id": consent_id,
            "version": consent.VERSION}


@app.get("/api/consent/current")
def api_consent_current(request: Request):
    """The consent this account has already given, if it is still the current
    wording. Returning it is what lets a contributor come back tomorrow and
    record without re-reading a screen they have already agreed to — while a
    bumped version puts the screen back in front of them."""
    u = current_user(request)
    if not u:
        return JSONResponse({"error": "sign in first"}, status_code=401)
    with db.conn() as c:
        row = c.execute(
            "SELECT id FROM consents WHERE contributor_id = ? AND version = ?"
            " AND text_hash = ? AND withdrawn_at IS NULL"
            " ORDER BY agreed_at DESC LIMIT 1",
            (u["id"], consent.VERSION, consent.text_hash()),
        ).fetchone()
    return {"consent_id": row["id"] if row else None, "version": consent.VERSION}


# ---- phrases ---------------------------------------------------------------

@app.get("/api/phrases")
def api_phrases(request: Request, limit: int = 20):
    """The queue, neediest first.

    A phrase this contributor has already recorded drops to the back rather
    than out: one person signing the same phrase twice is far less useful
    than two people signing it once, but on a pilot with three contributors
    a second take still beats no take."""
    u = current_user(request)
    if not u or u["status"] != "approved":
        return JSONResponse({"error": "not approved"}, status_code=403)
    contributor_id = u["id"]
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

    u = current_user(request)
    if not u:
        return JSONResponse({"error": "sign in first"}, status_code=401)
    if u["status"] != "approved":
        return JSONResponse({"error": "account not approved yet"}, status_code=403)

    # Whose clip this is comes from the session cookie. Taking it from the
    # body would let anyone file recordings under someone else's name — and
    # under someone else's consent record.
    contributor_id = u["id"]
    phrase_id = str(payload.get("phrase_id") or "")[:80]
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
def api_contribute_video(cid: str, payload: dict, request: Request):
    """Called after the browser's PUT. We verify against R2 rather than
    trusting the report — a video the bucket does not have is not a video."""
    u = current_user(request)
    if not u:
        return JSONResponse({"error": "sign in first"}, status_code=401)
    with db.conn() as c:
        row = c.execute(
            "SELECT video_key, video_status FROM contributions"
            " WHERE id = ? AND contributor_id = ?", (cid, u["id"]),
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
def api_me(request: Request):
    """Progress for the encouragement line. Rejected clips still count here:
    a person who showed up and signed did contribute, and telling them
    otherwise would be both discouraging and beside the point."""
    u = current_user(request)
    if not u:
        return {"total": 0, "today": 0, "phrases": 0}
    contributor_id = u["id"]
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


# ---- review ----------------------------------------------------------------

REJECT_REASONS = ("wrong-sign", "unclear", "face-not-visible", "other")


def _can_review(u: dict | None) -> bool:
    return bool(u and u["status"] == "approved" and u["role"] in ("reviewer", "admin"))


@app.get("/api/review/queue")
def api_review_queue(request: Request, limit: int = 12):
    """Clips still waiting on a verdict from this reviewer.

    Two exclusions matter. A reviewer never sees their own recording — a
    person is the worst judge of whether their own signing was clear. And a
    clip they have already voted on is gone from their queue, because two
    approvals has to mean two people.
    """
    u = current_user(request)
    if not _can_review(u):
        return JSONResponse({"error": "not a reviewer"}, status_code=403)

    limit = max(1, min(limit, 50))
    with db.conn() as c:
        rows = c.execute(
            """
            SELECT c.id, c.phrase_id, c.duration_ms, c.fps, c.frame_count,
                   c.cov_body, c.cov_face, c.cov_hand_l, c.cov_hand_r,
                   c.video_key, c.video_status, c.created_at, c.variant_tag,
                   p.hi, p.en, p.gloss, p.kind, p.face AS face_prompt,
                   p.note AS phrase_note,
                   u.display_name AS contributor_name,
                   (SELECT COUNT(*) FROM reviews r2 WHERE r2.contribution_id = c.id
                     AND r2.verdict = 'approve') AS approvals,
                   (SELECT COUNT(*) FROM reviews r3 WHERE r3.contribution_id = c.id
                     AND r3.verdict = 'reject') AS rejections
              FROM contributions c
              JOIN phrases p ON p.id = c.phrase_id
              LEFT JOIN users u ON u.id = c.contributor_id
             WHERE c.deleted_at IS NULL
               AND c.review_status = 'pending'
               AND c.contributor_id != ?
               AND NOT EXISTS (SELECT 1 FROM reviews r
                                WHERE r.contribution_id = c.id AND r.reviewer_id = ?)
             ORDER BY c.created_at ASC
             LIMIT ?
            """,
            (u["id"], u["id"], limit),
        ).fetchall()

        items = []
        for r in rows:
            d = dict(r)
            # Keypoints travel with the clip: the pose is what gets trained
            # on, so it is what a reviewer should be looking at. The video is
            # a bonus that may not exist at all until R2 is configured.
            kp = c.execute("SELECT keypoints FROM contributions WHERE id = ?",
                           (r["id"],)).fetchone()
            d["frames"] = db.unpack_keypoints(kp["keypoints"])
            d["video_url"] = (storage.presign_get(r["video_key"])
                              if r["video_status"] == "stored" and r["video_key"] else None)
            items.append(d)

    return {"clips": items, "reasons": list(REJECT_REASONS),
            "needed": db.REVIEWS_TO_SETTLE}


@app.post("/api/review/{cid}")
def api_review(cid: str, payload: dict, request: Request):
    u = current_user(request)
    if not _can_review(u):
        return JSONResponse({"error": "not a reviewer"}, status_code=403)

    verdict = str(payload.get("verdict") or "")
    if verdict not in ("approve", "reject"):
        return JSONResponse({"error": "bad verdict"}, status_code=422)
    reason = str(payload.get("reason") or "")[:40]
    if verdict == "reject" and reason not in REJECT_REASONS:
        return JSONResponse({"error": "a reason is required"}, status_code=422)
    variant_tag = str(payload.get("variant_tag") or "").strip()[:60]
    note = str(payload.get("note") or "").strip()[:400]

    with db.conn() as c:
        row = c.execute(
            "SELECT contributor_id FROM contributions WHERE id = ? AND deleted_at IS NULL",
            (cid,),
        ).fetchone()
        if not row:
            return JSONResponse({"error": "unknown clip"}, status_code=404)
        if row["contributor_id"] == u["id"]:
            return JSONResponse({"error": "you cannot review your own clip"},
                                status_code=403)
        try:
            c.execute(
                "INSERT INTO reviews (id, contribution_id, reviewer_id, verdict,"
                " reason, variant_tag, note) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (db.new_id("r"), cid, u["id"], verdict, reason, variant_tag, note),
            )
        except sqlite3.IntegrityError:
            return JSONResponse({"error": "you have already reviewed this clip"},
                                status_code=409)
        status = db.settle(cid, c)

    return {"ok": True, "id": cid, "review_status": status}


@app.get("/api/review/stats")
def api_review_stats(request: Request):
    u = current_user(request)
    if not _can_review(u):
        return JSONResponse({"error": "not a reviewer"}, status_code=403)
    with db.conn() as c:
        mine = c.execute("SELECT COUNT(*) FROM reviews WHERE reviewer_id = ?",
                         (u["id"],)).fetchone()[0]
        waiting = c.execute(
            "SELECT COUNT(*) FROM contributions c WHERE c.deleted_at IS NULL"
            " AND c.review_status = 'pending' AND c.contributor_id != ?"
            " AND NOT EXISTS (SELECT 1 FROM reviews r WHERE r.contribution_id = c.id"
            "                  AND r.reviewer_id = ?)", (u["id"], u["id"])).fetchone()[0]
    return {"reviewed": mine, "waiting": waiting}


# ---- admin -----------------------------------------------------------------

@app.get("/api/admin/stats")
def api_admin_stats(request: Request, x_admin_key: str | None = Header(None)):
    if not _is_admin(request, x_admin_key):
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


@app.get("/api/admin/users")
def api_admin_users(request: Request, status: str = "",
                    x_admin_key: str | None = Header(None)):
    if not _is_admin(request, x_admin_key):
        return Response(status_code=401)
    sql = ("SELECT u.*,"
           " (SELECT COUNT(*) FROM contributions x WHERE x.contributor_id = u.id"
           "   AND x.deleted_at IS NULL) AS clips"
           " FROM users u")
    args: list = []
    if status:
        sql += " WHERE u.status = ?"
        args.append(status)
    # Pending first: the whole point of this screen is the waiting room.
    sql += (" ORDER BY CASE u.status WHEN 'pending' THEN 0 ELSE 1 END,"
            " u.created_at DESC LIMIT 500")
    with db.conn() as c:
        rows = c.execute(sql, args).fetchall()
    return {"users": [{
        "id": r["id"], "name": r["display_name"], "identifier": r["identifier"],
        "role": r["role"], "status": r["status"], "note": r["note"],
        "clips": r["clips"], "created_at": r["created_at"],
        "approved_at": r["approved_at"], "last_seen_at": r["last_seen_at"],
    } for r in rows]}


@app.post("/api/admin/users/{uid}/status")
def api_admin_set_status(uid: str, payload: dict, request: Request,
                         x_admin_key: str | None = Header(None)):
    """Approve, reject or suspend an account, and set its role while you are
    there — approving an NGO partner as a reviewer is one action, not two."""
    if not _is_admin(request, x_admin_key):
        return Response(status_code=401)

    status = str(payload.get("status") or "")
    if status not in ("approved", "rejected", "suspended", "pending"):
        return JSONResponse({"error": "bad status"}, status_code=422)
    role = str(payload.get("role") or "")
    if role and role not in ("contributor", "reviewer", "admin"):
        return JSONResponse({"error": "bad role"}, status_code=422)

    actor = current_user(request)
    with db.conn() as c:
        row = c.execute("SELECT id, role FROM users WHERE id = ?", (uid,)).fetchone()
        if not row:
            return JSONResponse({"error": "unknown user"}, status_code=404)
        # Locking yourself out of the only admin account on a box with no
        # shell is not a recoverable mistake.
        if actor and actor["id"] == uid and status != "approved":
            return JSONResponse({"error": "you cannot lock yourself out"},
                                status_code=422)
        if row["role"] == "admin" and role and role != "admin":
            admins = c.execute(
                "SELECT COUNT(*) FROM users WHERE role = 'admin'").fetchone()[0]
            if admins <= 1:
                return JSONResponse({"error": "this is the only admin"},
                                    status_code=422)

        c.execute(
            "UPDATE users SET status = ?, role = COALESCE(NULLIF(?, ''), role),"
            " approved_at = CASE WHEN ? = 'approved' THEN unixepoch('now')"
            "                    ELSE approved_at END,"
            " approved_by = ? WHERE id = ?",
            (status, role, status, actor["id"] if actor else "admin-key", uid),
        )

    # Revoking access has to actually revoke it, not wait for a cookie to age
    # out thirty days from now.
    if status in ("rejected", "suspended"):
        auth.end_all_sessions(uid)
    return {"ok": True, "id": uid, "status": status}


@app.get("/api/admin/export.jsonl")
def api_admin_export(request: Request, x_admin_key: str | None = Header(None),
                     review_status: str = "", limit: int = 5000):
    """The handover format, exactly as agreed with Track B in the brief.

    Defaults to everything not deleted so the pilot can be inspected before
    review exists; pass ?review_status=approved once M2 is running and this
    becomes the training export."""
    if not _is_admin(request, x_admin_key):
        return Response(status_code=401)

    sql = ("SELECT c.*, p.gloss, p.hi, p.gu, p.en, p.kind, p.tier FROM contributions c"
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
                    "kind": r["kind"],
                    "tier": r["tier"],
                    "text": {"hi": r["hi"], "en": r["en"],
                             **({"gu": r["gu"]} if r["gu"] else {})},
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
            "consent_version": consent.VERSION, "pose_format": POSE_FORMAT,
            "access_mode": db.ACCESS_MODE,
            # Public by design — the sitekey is the half of a Turnstile pair
            # that is meant to be in the page. Served rather than compiled in
            # so it can change without a rebuild.
            "turnstile_sitekey": os.environ.get("TURNSTILE_SITEKEY", "")}


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
