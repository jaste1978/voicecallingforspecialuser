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
    return {"id": row["id"], "email": row["email"], "name": row["name"], "role": row["role"]}


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
            """SELECT u.id, u.email, u.name, u.role FROM sessions s
               JOIN users u ON u.id = s.user_id
               WHERE s.token = ? AND s.created_at > ?""",
            (token, time.time() - SESSION_TTL_S),
        ).fetchone()
    return dict(row) if row else None


def delete_session(token: str) -> None:
    with _conn() as conn:
        conn.execute("DELETE FROM sessions WHERE token = ?", (token,))


init()
