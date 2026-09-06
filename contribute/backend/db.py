"""SQLite storage for the ISL contribution platform.

Own database, own Railway volume — deliberately not the main app's. The two
services deploy independently and a contribution has nothing to do with a
call, so sharing a file would only couple two things that never query each
other.

Shape notes worth knowing:

* Keypoints live in the row, gzipped. A 4-second take is ~80KB of JSON and
  ~8KB compressed, so a thousand clips is well under 100MB — nothing that
  justifies a second storage system. Video, which is 100× that, goes to R2.
* `consent_id` is NOT NULL on contributions. The non-negotiable is that no
  clip can exist without the consent it was given under, and a schema
  constraint is the only version of that promise that cannot be forgotten.
* `review_status` and `variant_tag` exist from day one even though the
  review UI is M2, because Track B's export format includes them and the
  format is a contract, not an afterthought.
* People are one table, `users`, whatever their role. Tejas reviews and also
  records; an NGO partner who reviews may well contribute too. Splitting
  contributors from reviewers would have meant two rows for the same person
  and a choice about which one owns their consent.
"""

import gzip
import json
import os
import sqlite3
import uuid
from pathlib import Path

# Railway mounts the volume at /data; a plain checkout just writes here.
DB_PATH = os.environ.get("CONTRIBUTE_DB", str(Path(__file__).with_name("contribute.db")))

CONSENT_VERSION = "v1-draft"

# 'approval' — new accounts wait for an admin. 'open' — anyone who registers
# can record straight away. The pilot runs on approval, but flipping this is
# how the platform opens up later without any of it being rewritten.
ACCESS_MODE = os.environ.get("ACCESS_MODE", "approval")

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    device_id TEXT,
    display_name TEXT DEFAULT '',
    contact TEXT DEFAULT '',
    credit_optin INTEGER DEFAULT 0,
    created_at REAL DEFAULT (unixepoch('now')),
    identifier TEXT DEFAULT '',
    password_hash TEXT DEFAULT '',
    role TEXT DEFAULT 'contributor',
    status TEXT DEFAULT 'pending',
    note TEXT DEFAULT '',
    approved_at REAL,
    approved_by TEXT DEFAULT '',
    last_seen_at REAL
);
CREATE INDEX IF NOT EXISTS idx_users_device ON users(device_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_identifier
    ON users(identifier) WHERE identifier != '';
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);

CREATE TABLE IF NOT EXISTS sessions (
    -- The raw token never lands here, only its SHA-256. A copy of this file
    -- is a list of who signed in, not a way to sign in as them.
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    created_at REAL DEFAULT (unixepoch('now')),
    expires_at REAL NOT NULL,
    user_agent TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS consents (
    id TEXT PRIMARY KEY,
    contributor_id TEXT NOT NULL,
    version TEXT NOT NULL,
    text_hash TEXT NOT NULL,
    lang TEXT DEFAULT 'hi',
    credit_optin INTEGER DEFAULT 0,
    agreed_at REAL DEFAULT (unixepoch('now')),
    withdrawn_at REAL,
    user_agent TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_consents_contributor ON consents(contributor_id);

CREATE TABLE IF NOT EXISTS phrases (
    id TEXT PRIMARY KEY,
    hi TEXT NOT NULL,
    gu TEXT DEFAULT '',
    en TEXT NOT NULL,
    gloss TEXT NOT NULL,
    kind TEXT NOT NULL,
    tier INTEGER NOT NULL,
    face TEXT DEFAULT '',
    note TEXT DEFAULT '',
    target_count INTEGER DEFAULT 4,
    active INTEGER DEFAULT 1,
    sort INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS contributions (
    id TEXT PRIMARY KEY,
    phrase_id TEXT NOT NULL,
    contributor_id TEXT NOT NULL,
    consent_id TEXT NOT NULL,
    pose_format INTEGER NOT NULL,
    fps REAL DEFAULT 0,
    duration_ms INTEGER DEFAULT 0,
    frame_count INTEGER DEFAULT 0,
    cov_body REAL DEFAULT 0,
    cov_face REAL DEFAULT 0,
    cov_hand_l REAL DEFAULT 0,
    cov_hand_r REAL DEFAULT 0,
    keypoints BLOB,
    keypoints_bytes INTEGER DEFAULT 0,
    video_key TEXT DEFAULT '',
    video_mime TEXT DEFAULT '',
    video_status TEXT DEFAULT 'none',
    video_bytes INTEGER DEFAULT 0,
    review_status TEXT DEFAULT 'pending',
    variant_tag TEXT DEFAULT '',
    client TEXT DEFAULT '',
    created_at REAL DEFAULT (unixepoch('now')),
    deleted_at REAL
);
CREATE INDEX IF NOT EXISTS idx_contrib_phrase ON contributions(phrase_id);
CREATE INDEX IF NOT EXISTS idx_contrib_contributor ON contributions(contributor_id);
CREATE INDEX IF NOT EXISTS idx_contrib_review ON contributions(review_status);

CREATE TABLE IF NOT EXISTS reviews (
    id TEXT PRIMARY KEY,
    contribution_id TEXT NOT NULL,
    reviewer_id TEXT NOT NULL,
    verdict TEXT NOT NULL,          -- 'approve' | 'reject'
    reason TEXT DEFAULT '',         -- why, when rejecting
    variant_tag TEXT DEFAULT '',    -- a regional variant is data, not a fault
    note TEXT DEFAULT '',
    created_at REAL DEFAULT (unixepoch('now'))
);
-- One vote per reviewer per clip. Without this, refreshing the queue twice
-- would let one person carry a clip to the two approvals it needs.
CREATE UNIQUE INDEX IF NOT EXISTS idx_reviews_once
    ON reviews(contribution_id, reviewer_id);
CREATE INDEX IF NOT EXISTS idx_reviews_contribution ON reviews(contribution_id);
"""


def conn() -> sqlite3.Connection:
    c = sqlite3.connect(DB_PATH, timeout=15)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("PRAGMA foreign_keys=ON")
    return c


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:16]}"


def init(seed_path: str | None = None) -> None:
    with conn() as c:
        _rename_legacy(c)
        c.executescript(SCHEMA)
        _add_missing_columns(c)
        c.execute("DELETE FROM sessions WHERE expires_at < unixepoch('now')")
    seed_phrases(seed_path)


def _rename_legacy(c: sqlite3.Connection) -> None:
    """M1 shipped this table as `contributors`, before accounts existed. Any
    clips recorded in that window still point at these ids, so the table is
    renamed rather than replaced."""
    tables = {r[0] for r in c.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table'")}
    if "contributors" in tables and "users" not in tables:
        c.execute("ALTER TABLE contributors RENAME TO users")


def _add_missing_columns(c: sqlite3.Connection) -> None:
    """CREATE TABLE IF NOT EXISTS does nothing to a table that already
    exists, so a renamed M1 table needs its new columns added by hand."""
    have = {r[1] for r in c.execute("PRAGMA table_info(users)")}
    added = {
        "identifier": "TEXT DEFAULT ''",
        "password_hash": "TEXT DEFAULT ''",
        "role": "TEXT DEFAULT 'contributor'",
        # Accounts that pre-date the login keep working: they were recording
        # under a consent they had already given.
        "status": "TEXT DEFAULT 'approved'",
        "note": "TEXT DEFAULT ''",
        "approved_at": "REAL",
        "approved_by": "TEXT DEFAULT ''",
        "last_seen_at": "REAL",
    }
    for name, decl in added.items():
        if name not in have:
            c.execute(f"ALTER TABLE users ADD COLUMN {name} {decl}")


def seed_phrases(seed_path: str | None = None) -> int:
    """Upsert the generated seed. Re-run on every boot so a phrase whose
    gloss or facial-grammar note changed upstream is corrected in place —
    but `active` and `target_count` are left alone once a row exists, since
    those are the admin's to tune per how recording is actually going."""
    path = Path(seed_path or Path(__file__).with_name("phrases_seed.json"))
    if not path.exists():
        return 0
    rows = json.loads(path.read_text())
    with conn() as c:
        for r in rows:
            c.execute(
                """INSERT INTO phrases
                       (id, hi, gu, en, gloss, kind, tier, face, note, target_count, sort)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                   ON CONFLICT(id) DO UPDATE SET
                       hi=excluded.hi, gu=excluded.gu, en=excluded.en,
                       gloss=excluded.gloss, kind=excluded.kind, tier=excluded.tier,
                       face=excluded.face, note=excluded.note, sort=excluded.sort""",
                (r["id"], r["hi"], r.get("gu", ""), r["en"], r["gloss"], r["kind"],
                 r["tier"], r.get("face", ""), r.get("note", ""),
                 r.get("target_count", 4), r.get("sort", 0)),
            )
    return len(rows)


# How many agreeing reviewers settle a clip. Two, per the brief: one person
# can be wrong about a sign, and regional variation means "that is not how I
# sign it" is not the same as "that is wrong".
REVIEWS_TO_SETTLE = 2


def settle(contribution_id: str, c: sqlite3.Connection) -> str:
    """Recompute a clip's review status from the votes cast on it.

    Derived rather than incremented, so a changed vote or a removed reviewer
    can never leave a clip stuck in a status nobody voted for. Split verdicts
    stay pending and wait for a third opinion — a disagreement about a sign is
    exactly the case where a tie-break is worth having.
    """
    rows = c.execute(
        "SELECT verdict, variant_tag FROM reviews WHERE contribution_id = ?",
        (contribution_id,),
    ).fetchall()
    approve = sum(1 for r in rows if r["verdict"] == "approve")
    reject = sum(1 for r in rows if r["verdict"] == "reject")

    status = "pending"
    if approve >= REVIEWS_TO_SETTLE:
        status = "approved"
    elif reject >= REVIEWS_TO_SETTLE:
        status = "rejected"

    # A variant tag from any reviewer sticks: it is a fact about the clip, not
    # a vote about it, and it is what keeps regional signing in the dataset
    # instead of being quietly outvoted by whoever signs it differently.
    tag = next((r["variant_tag"] for r in rows if r["variant_tag"]), "")

    c.execute("UPDATE contributions SET review_status = ?, variant_tag = ?"
              " WHERE id = ?", (status, tag, contribution_id))
    return status


# ---- keypoints -------------------------------------------------------------

def pack_keypoints(frames: list) -> bytes:
    return gzip.compress(json.dumps(frames, separators=(",", ":")).encode(), 6)


def unpack_keypoints(blob: bytes | None) -> list:
    if not blob:
        return []
    return json.loads(gzip.decompress(blob).decode())
