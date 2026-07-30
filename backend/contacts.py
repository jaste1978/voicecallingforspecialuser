"""Contacts storage (same SQLite DB as call history), scoped per user."""

import sqlite3

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
        try:
            conn.execute("ALTER TABLE contacts ADD COLUMN user_id INTEGER")
        except sqlite3.OperationalError:
            pass  # column already exists


def list_contacts(user_id: int | None = None) -> list[dict]:
    with _conn() as conn:
        if user_id is None:
            rows = conn.execute(
                "SELECT * FROM contacts ORDER BY name COLLATE NOCASE"
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM contacts WHERE user_id = ? ORDER BY name COLLATE NOCASE",
                (user_id,),
            ).fetchall()
    return [dict(r) for r in rows]


def add_contact(name: str, number: str, user_id: int | None = None) -> dict:
    with _conn() as conn:
        cur = conn.execute(
            "INSERT INTO contacts (name, number, user_id) VALUES (?, ?, ?)",
            (name, number, user_id),
        )
        return {"id": cur.lastrowid, "name": name, "number": number}


def delete_contact(contact_id: int, user_id: int | None = None) -> None:
    with _conn() as conn:
        if user_id is None:
            conn.execute("DELETE FROM contacts WHERE id = ?", (contact_id,))
        else:
            conn.execute(
                "DELETE FROM contacts WHERE id = ? AND user_id = ?",
                (contact_id, user_id),
            )


init()
