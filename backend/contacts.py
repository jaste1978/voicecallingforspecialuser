"""Contacts storage (same SQLite DB as call history)."""

from history import _conn


def init() -> None:
    with _conn() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS contacts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                number TEXT NOT NULL,
                created_at REAL DEFAULT (unixepoch('now'))
            )
        """)


def list_contacts() -> list[dict]:
    with _conn() as conn:
        rows = conn.execute("SELECT * FROM contacts ORDER BY name COLLATE NOCASE").fetchall()
    return [dict(r) for r in rows]


def add_contact(name: str, number: str) -> dict:
    with _conn() as conn:
        cur = conn.execute(
            "INSERT INTO contacts (name, number) VALUES (?, ?)", (name, number)
        )
        return {"id": cur.lastrowid, "name": name, "number": number}


def delete_contact(contact_id: int) -> None:
    with _conn() as conn:
        conn.execute("DELETE FROM contacts WHERE id = ?", (contact_id,))


init()
