"""Accounts, passwords and sessions.

The platform is invitation-shaped for now: anyone can register, an admin
decides who records. That is a deliberate narrowing of the original
zero-login design and it fits the pilot — a handful of NGO signers, no spam,
no clips from someone who never read the consent screen. `ACCESS_MODE=open`
turns the gate off again when it is time to scale, without touching code.

No auth library. scrypt and hmac are in the standard library, and a
dependency that handles passwords is a dependency you have to keep patched.
"""

import hashlib
import hmac
import logging
import os
import re
import secrets
import time

import db

logger = logging.getLogger("contribute.auth")

SESSION_COOKIE = "isl_session"
SESSION_DAYS = 30

# scrypt at these parameters costs ~25ms per hash and 16MB of memory. The
# memory is the point: it is what makes a stolen database expensive to attack
# with GPUs, in a way that a fast hash never is.
_SCRYPT = {"n": 2 ** 14, "r": 8, "p": 1}
_KEYLEN = 32

MIN_PASSWORD = 8

# Failed logins, per identifier, in this process. Not a distributed rate
# limiter — one uvicorn process serves this service, and the point is to make
# guessing a password over the network hopeless, not to survive a botnet.
_fails: dict[str, list[float]] = {}
LOCK_AFTER = 8
LOCK_WINDOW = 900  # 15 minutes


# ---- identifiers -----------------------------------------------------------

def normalise_identifier(raw: str) -> str:
    """Email or phone, folded to one canonical form so that
    ' Priya@Example.com ' and '+91 98765 43210' cannot each register twice."""
    s = (raw or "").strip()
    if "@" in s:
        return s.lower()
    digits = re.sub(r"[^\d]", "", s)
    # One person, one account: an Indian mobile gets written as 9876543210,
    # 09876543210 and +91 98765 43210 by the same person on the same day. No
    # ten-digit Indian mobile starts with a zero, so stripping them is safe.
    digits = digits.lstrip("0")
    if len(digits) == 12 and digits.startswith("91"):
        digits = digits[2:]
    return digits


def identifier_ok(value: str) -> bool:
    if "@" in value:
        return bool(re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", value))
    return 7 <= len(value) <= 15 and value.isdigit()


# ---- passwords -------------------------------------------------------------

def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    key = hashlib.scrypt(password.encode(), salt=salt, dklen=_KEYLEN, **_SCRYPT)
    return f"scrypt${_SCRYPT['n']}${_SCRYPT['r']}${_SCRYPT['p']}${salt.hex()}${key.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        scheme, n, r, p, salt_hex, key_hex = stored.split("$")
        if scheme != "scrypt":
            return False
        key = hashlib.scrypt(
            password.encode(), salt=bytes.fromhex(salt_hex),
            n=int(n), r=int(r), p=int(p), dklen=len(key_hex) // 2,
        )
    except Exception:
        return False
    return hmac.compare_digest(key.hex(), key_hex)


def locked_out(identifier: str) -> bool:
    now = time.time()
    recent = [t for t in _fails.get(identifier, []) if now - t < LOCK_WINDOW]
    _fails[identifier] = recent
    return len(recent) >= LOCK_AFTER


def note_failure(identifier: str) -> None:
    _fails.setdefault(identifier, []).append(time.time())


def clear_failures(identifier: str) -> None:
    _fails.pop(identifier, None)


# ---- sessions --------------------------------------------------------------

def _digest(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def start_session(user_id: str, user_agent: str = "") -> str:
    token = secrets.token_urlsafe(32)
    with db.conn() as c:
        c.execute(
            "INSERT INTO sessions (token_hash, user_id, expires_at, user_agent)"
            " VALUES (?, ?, ?, ?)",
            (_digest(token), user_id, time.time() + SESSION_DAYS * 86400,
             user_agent[:180]),
        )
    return token


def end_session(token: str) -> None:
    if not token:
        return
    with db.conn() as c:
        c.execute("DELETE FROM sessions WHERE token_hash = ?", (_digest(token),))


def end_all_sessions(user_id: str) -> None:
    """Used when an account is rejected or suspended — revoking access has to
    actually revoke it, not wait 30 days for a cookie to expire."""
    with db.conn() as c:
        c.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))


def user_for_token(token: str) -> dict | None:
    if not token:
        return None
    with db.conn() as c:
        row = c.execute(
            "SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id"
            " WHERE s.token_hash = ? AND s.expires_at > unixepoch('now')",
            (_digest(token),),
        ).fetchone()
        if row:
            c.execute("UPDATE users SET last_seen_at = unixepoch('now')"
                      " WHERE id = ?", (row["id"],))
    return dict(row) if row else None


# ---- the admin account -----------------------------------------------------

def ensure_admin() -> str | None:
    """Bootstrap the owner's account from the environment on boot.

    Without this the first admin would have to be made by hand in SQL on a
    box with no shell. The password is only ever applied to a fresh account
    or when ADMIN_PASSWORD_RESET is set, so redeploying does not quietly
    overwrite a password that was changed later."""
    identifier = normalise_identifier(os.environ.get("ADMIN_EMAIL", ""))
    password = os.environ.get("ADMIN_PASSWORD", "")
    if not identifier or not password:
        return None

    with db.conn() as c:
        row = c.execute("SELECT id, password_hash FROM users WHERE identifier = ?",
                        (identifier,)).fetchone()
        if row:
            if os.environ.get("ADMIN_PASSWORD_RESET"):
                c.execute("UPDATE users SET password_hash = ?, role = 'admin',"
                          " status = 'approved' WHERE id = ?",
                          (hash_password(password), row["id"]))
                logger.warning("admin password reset for %s", identifier)
            else:
                c.execute("UPDATE users SET role = 'admin', status = 'approved'"
                          " WHERE id = ?", (row["id"],))
            return row["id"]

        uid = db.new_id("u")
        c.execute(
            "INSERT INTO users (id, identifier, display_name, password_hash, role,"
            " status, approved_at) VALUES (?, ?, ?, ?, 'admin', 'approved',"
            " unixepoch('now'))",
            (uid, identifier, os.environ.get("ADMIN_NAME", "Admin"),
             hash_password(password)),
        )
        logger.info("created admin account %s", identifier)
        return uid
