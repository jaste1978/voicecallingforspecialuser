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


def set_status(user_id: int, status: str) -> dict | None:
    with _conn() as conn:
        conn.execute("UPDATE users SET status = ? WHERE id = ?", (status, user_id))
        row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
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
