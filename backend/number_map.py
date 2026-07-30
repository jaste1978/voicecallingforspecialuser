"""Phone-number -> user routing for multi-tenant calls.

A user registers the mobile number they forward to the shared SunoSathi
DID. Vobiz's answer webhook carries ForwardedFrom, which we match here to
decide whose app rings. Dedicated per-user DIDs also live in this table
(kind='did') and are matched against the webhook's To number.
"""

from history import _conn


def init() -> None:
    with _conn() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS numbers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                number TEXT NOT NULL UNIQUE,
                kind TEXT NOT NULL DEFAULT 'forwarded',
                created_at REAL DEFAULT (unixepoch('now'))
            )
        """)


def _last10(number: str) -> str:
    digits = "".join(ch for ch in (number or "") if ch.isdigit())
    return digits[-10:]


def resolve(forwarded_from: str, to_number: str) -> int | None:
    """Which user's line should ring for this incoming call?"""
    with _conn() as conn:
        for candidate in (_last10(forwarded_from), _last10(to_number)):
            if not candidate:
                continue
            row = conn.execute(
                "SELECT user_id FROM numbers WHERE number = ?", (candidate,)
            ).fetchone()
            if row:
                return row["user_id"]
    return None


def number_for_user(user_id: int) -> str | None:
    with _conn() as conn:
        row = conn.execute(
            "SELECT number FROM numbers WHERE user_id = ? ORDER BY id LIMIT 1",
            (user_id,),
        ).fetchone()
    return row["number"] if row else None


def list_numbers() -> list[dict]:
    with _conn() as conn:
        rows = conn.execute("SELECT * FROM numbers ORDER BY id").fetchall()
    return [dict(r) for r in rows]


def add_number(user_id: int, number: str, kind: str = "forwarded") -> dict:
    n = _last10(number)
    if len(n) != 10:
        raise ValueError("need a 10-digit Indian mobile number")
    with _conn() as conn:
        cur = conn.execute(
            "INSERT INTO numbers (user_id, number, kind) VALUES (?, ?, ?)",
            (user_id, n, kind),
        )
        return {"id": cur.lastrowid, "user_id": user_id, "number": n, "kind": kind}


def delete_number(number_id: int) -> None:
    with _conn() as conn:
        conn.execute("DELETE FROM numbers WHERE id = ?", (number_id,))


init()
