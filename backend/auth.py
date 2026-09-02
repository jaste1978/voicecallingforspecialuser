"""Email + password authentication with opaque session tokens.

Passwords are scrypt-hashed (stdlib). Sessions are random tokens valid for
SESSION_TTL_S, checked on every protected request/websocket.
"""

import hashlib
import hmac
import secrets
import time

from history import _conn

SESSION_TTL_S = 60 * 60 * 24 * 30  # 30 days


def init() -> None:
    with _conn() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE NOT NULL,
                name TEXT,
                role TEXT DEFAULT 'user',
                pw_salt BLOB NOT NULL,
                pw_hash BLOB NOT NULL,
                created_at REAL DEFAULT (unixepoch('now'))
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS sessions (
                token TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                created_at REAL DEFAULT (unixepoch('now'))
            )
        """)
        # self-registration: pending until an admin approves
        for ddl in (
            "ALTER TABLE users ADD COLUMN status TEXT DEFAULT 'active'",
            "ALTER TABLE users ADD COLUMN requested_number TEXT",
            # Sathi ID: app-to-app calling address, no phone number needed
            "ALTER TABLE users ADD COLUMN handle TEXT",
        ):
            try:
                conn.execute(ddl)
            except Exception:
                pass


def _hash(password: str, salt: bytes) -> bytes:
    return hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1)


def create_user(email: str, password: str, name: str = "", role: str = "user") -> int:
    salt = secrets.token_bytes(16)
    with _conn() as conn:
        cur = conn.execute(
            "INSERT INTO users (email, name, role, pw_salt, pw_hash) VALUES (?, ?, ?, ?, ?)",
            (email.strip().lower(), name, role, salt, _hash(password, salt)),
        )
        return cur.lastrowid


def register(email: str, password: str, name: str, number: str) -> int:
    """Self sign-up: account exists but stays 'pending' until approved."""
    salt = secrets.token_bytes(16)
    with _conn() as conn:
        cur = conn.execute(
            "INSERT INTO users (email, name, role, status, requested_number,"
            " pw_salt, pw_hash) VALUES (?, ?, 'user', 'pending', ?, ?, ?)",
            (email.strip().lower(), name, number, salt, _hash(password, salt)),
        )
        return cur.lastrowid


def set_password(user_id: int, new_password: str) -> None:
    salt = secrets.token_bytes(16)
    with _conn() as conn:
        conn.execute("UPDATE users SET pw_salt = ?, pw_hash = ? WHERE id = ?",
                     (salt, _hash(new_password, salt), user_id))


def change_password(user_id: int, old_password: str, new_password: str) -> bool:
    """Verify the old password, then set the new one. Keeps other rules
    (length) to the caller."""
    with _conn() as conn:
        row = conn.execute("SELECT pw_salt, pw_hash FROM users WHERE id = ?",
                           (user_id,)).fetchone()
    if row is None or not hmac.compare_digest(
            _hash(old_password, row["pw_salt"]), row["pw_hash"]):
        return False
    set_password(user_id, new_password)
    return True


def drop_sessions(user_id: int, keep_token: str | None = None) -> None:
    with _conn() as conn:
        if keep_token:
            conn.execute("DELETE FROM sessions WHERE user_id = ? AND token != ?",
                         (user_id, keep_token))
        else:
            conn.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))


def set_status(user_id: int, status: str) -> dict | None:
    with _conn() as conn:
        conn.execute("UPDATE users SET status = ? WHERE id = ?", (status, user_id))
        row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    return dict(row) if row else None


def _slug(text: str) -> str:
    import re
    s = re.sub(r"[^a-z0-9]", "", (text or "").lower())
    return s[:20]


def ensure_handle(user_id: int) -> str:
    """Return the user's Sathi ID, generating one from their name if absent."""
    with _conn() as conn:
        row = conn.execute("SELECT name, email, handle FROM users WHERE id = ?",
                           (user_id,)).fetchone()
        if row is None:
            return ""
        if row["handle"]:
            return row["handle"]
        base = _slug(row["name"]) or _slug(row["email"].split("@")[0]) or f"sathi{user_id}"
        handle = base
        n = 1
        while conn.execute("SELECT 1 FROM users WHERE handle = ? AND id != ?",
                           (handle, user_id)).fetchone():
            n += 1
            handle = f"{base}{n}"
        conn.execute("UPDATE users SET handle = ? WHERE id = ?", (handle, user_id))
    return handle


def by_handle(handle: str) -> dict | None:
    """Active user for a Sathi ID (case-insensitive)."""
    with _conn() as conn:
        row = conn.execute(
            "SELECT id, email, name, role, handle,"
            " COALESCE(status, 'active') AS status"
            " FROM users WHERE lower(handle) = ?", (handle.strip().lower(),)
        ).fetchone()
    if row is None or row["status"] != "active":
        return None
    return dict(row)


def user_by_id(user_id: int) -> dict | None:
    with _conn() as conn:
        row = conn.execute(
            "SELECT id, email, name, role, handle FROM users WHERE id = ?",
            (user_id,)).fetchone()
    return dict(row) if row else None


def user_count() -> int:
    with _conn() as conn:
        return conn.execute("SELECT COUNT(*) AS c FROM users").fetchone()["c"]


def verify(email: str, password: str) -> dict | None:
    with _conn() as conn:
        row = conn.execute(
            "SELECT * FROM users WHERE email = ?", (email.strip().lower(),)
        ).fetchone()
    if row is None:
        return None
    if not hmac.compare_digest(_hash(password, row["pw_salt"]), row["pw_hash"]):
        return None
    keys = row.keys()
    return {"id": row["id"], "email": row["email"], "name": row["name"],
            "role": row["role"],
            "status": (row["status"] if "status" in keys else "active") or "active"}


def create_session(user_id: int) -> str:
    token = secrets.token_hex(32)
    with _conn() as conn:
        conn.execute("INSERT INTO sessions (token, user_id) VALUES (?, ?)", (token, user_id))
        conn.execute(
            "DELETE FROM sessions WHERE created_at < ?", (time.time() - SESSION_TTL_S,)
        )
    return token


def user_for_token(token: str | None) -> dict | None:
    if not token:
        return None
    with _conn() as conn:
        row = conn.execute(
            """SELECT u.id, u.email, u.name, u.role,
                      COALESCE(u.status, 'active') AS status FROM sessions s
               JOIN users u ON u.id = s.user_id
               WHERE s.token = ? AND s.created_at > ?""",
            (token, time.time() - SESSION_TTL_S),
        ).fetchone()
    if row is None or row["status"] != "active":
        return None
    return dict(row)


def delete_session(token: str) -> None:
    with _conn() as conn:
        conn.execute("DELETE FROM sessions WHERE token = ?", (token,))


init()


def first_admin_id() -> int | None:
    """Fallback owner for calls that match no registered number."""
    with _conn() as conn:
        row = conn.execute(
            "SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1"
        ).fetchone()
        if row is None:
            row = conn.execute("SELECT id FROM users ORDER BY id LIMIT 1").fetchone()
    return row["id"] if row else None


def list_users() -> list[dict]:
    with _conn() as conn:
        rows = conn.execute(
            "SELECT id, email, name, role, created_at,"
            " COALESCE(status, 'active') AS status, requested_number"
            " FROM users ORDER BY id"
        ).fetchall()
    return [dict(r) for r in rows]
