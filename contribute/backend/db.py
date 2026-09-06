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

SCHEMA = """
CREATE TABLE IF NOT EXISTS contributors (
    id TEXT PRIMARY KEY,
    device_id TEXT,
    display_name TEXT DEFAULT '',
    contact TEXT DEFAULT '',
    credit_optin INTEGER DEFAULT 0,
    created_at REAL DEFAULT (unixepoch('now'))
);
CREATE INDEX IF NOT EXISTS idx_contributors_device ON contributors(device_id);

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
        c.executescript(SCHEMA)
    seed_phrases(seed_path)


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


# ---- keypoints -------------------------------------------------------------

def pack_keypoints(frames: list) -> bytes:
    return gzip.compress(json.dumps(frames, separators=(",", ":")).encode(), 6)


def unpack_keypoints(blob: bytes | None) -> list:
    if not blob:
        return []
    return json.loads(gzip.decompress(blob).decode())
