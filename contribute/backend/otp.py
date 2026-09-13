"""Email OTP for registration: a 6-digit code proves the inbox is real
before an account exists. One live code per email, hashed at rest."""

import hashlib
import secrets
import time

import db

TTL_S = 600          # a code is good for 10 minutes
MAX_ATTEMPTS = 5     # then the code is burned and a fresh one must be sent
RESEND_GAP_S = 45    # ignore resend mashing


def init() -> None:
    with db.conn() as c:
        c.execute("""
            CREATE TABLE IF NOT EXISTS email_otps (
                email TEXT PRIMARY KEY,
                code_hash TEXT NOT NULL,
                expires_at REAL NOT NULL,
                attempts INTEGER DEFAULT 0,
                sent_at REAL
            )
        """)


def _hash(code: str) -> str:
    return hashlib.sha256(code.encode()).hexdigest()


def issue(email: str) -> str | None:
    """Create (or replace) the code for this email. None = sent too
    recently; tell the person to check their inbox."""
    now = time.time()
    with db.conn() as c:
        row = c.execute("SELECT sent_at FROM email_otps WHERE email = ?",
                        (email,)).fetchone()
        if row and row["sent_at"] and now - row["sent_at"] < RESEND_GAP_S:
            return None
        code = f"{secrets.randbelow(1_000_000):06d}"
        c.execute(
            "INSERT INTO email_otps (email, code_hash, expires_at, attempts, sent_at)"
            " VALUES (?, ?, ?, 0, ?)"
            " ON CONFLICT(email) DO UPDATE SET code_hash = excluded.code_hash,"
            " expires_at = excluded.expires_at, attempts = 0,"
            " sent_at = excluded.sent_at",
            (email, _hash(code), now + TTL_S, now),
        )
    return code


def check(email: str, code: str) -> bool:
    """True burns the code; a wrong guess costs an attempt."""
    now = time.time()
    with db.conn() as c:
        row = c.execute("SELECT * FROM email_otps WHERE email = ?",
                        (email,)).fetchone()
        if not row or row["expires_at"] < now or row["attempts"] >= MAX_ATTEMPTS:
            return False
        if _hash((code or "").strip()) != row["code_hash"]:
            c.execute("UPDATE email_otps SET attempts = attempts + 1"
                      " WHERE email = ?", (email,))
            return False
        c.execute("DELETE FROM email_otps WHERE email = ?", (email,))
        return True
