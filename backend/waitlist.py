"""Pilot waitlist signups from the marketing site."""

from history import _conn


def init() -> None:
    with _conn() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS waitlist (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                email TEXT NOT NULL,
                role TEXT,
                org TEXT,
                message TEXT,
                created_at REAL DEFAULT (unixepoch('now'))
            )
        """)


def add(name: str, email: str, role: str, org: str, message: str) -> int:
    with _conn() as conn:
        cur = conn.execute(
            "INSERT INTO waitlist (name, email, role, org, message)"
            " VALUES (?, ?, ?, ?, ?)",
            (name[:80], email[:120], role[:60], org[:120], message[:1000]),
        )
        return cur.lastrowid


def list_all() -> list[dict]:
    with _conn() as conn:
        rows = conn.execute(
            "SELECT * FROM waitlist ORDER BY created_at DESC"
        ).fetchall()
    return [dict(r) for r in rows]


init()
