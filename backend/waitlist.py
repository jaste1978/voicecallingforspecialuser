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
        try:
            conn.execute("ALTER TABLE waitlist ADD COLUMN phone TEXT")
        except Exception:
            pass
        try:
            conn.execute("ALTER TABLE waitlist ADD COLUMN os TEXT")
        except Exception:
            pass
        # auto welcome email: when it was sent (NULL = not yet)
        try:
            conn.execute("ALTER TABLE waitlist ADD COLUMN emailed_at REAL")
        except Exception:
            pass


def add(name: str, email: str, role: str, org: str, message: str,
        phone: str = "", os_pref: str = "") -> int:
    with _conn() as conn:
        cur = conn.execute(
            "INSERT INTO waitlist (name, email, role, org, message, phone, os)"
            " VALUES (?, ?, ?, ?, ?, ?, ?)",
            (name[:80], email[:120], role[:60], org[:120], message[:1000],
             phone[:20], os_pref[:12]),
        )
        return cur.lastrowid


def mark_emailed(row_id: int) -> None:
    with _conn() as conn:
        conn.execute("UPDATE waitlist SET emailed_at = unixepoch('now')"
                     " WHERE id = ?", (row_id,))


def list_all() -> list[dict]:
    with _conn() as conn:
        rows = conn.execute(
            "SELECT * FROM waitlist ORDER BY created_at DESC"
        ).fetchall()
    return [dict(r) for r in rows]


init()
