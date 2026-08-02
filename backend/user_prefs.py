"""Per-user preferences (voice for type-to-speak, etc.). Simple KV store."""

from history import _conn


def init() -> None:
    with _conn() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS user_prefs (
                user_id INTEGER NOT NULL,
                key TEXT NOT NULL,
                value TEXT,
                PRIMARY KEY (user_id, key)
            )
        """)


def get(user_id: int, key: str, default: str | None = None) -> str | None:
    with _conn() as conn:
        row = conn.execute(
            "SELECT value FROM user_prefs WHERE user_id = ? AND key = ?",
            (user_id, key),
        ).fetchone()
    return row["value"] if row else default


def get_all(user_id: int) -> dict:
    with _conn() as conn:
        rows = conn.execute(
            "SELECT key, value FROM user_prefs WHERE user_id = ?", (user_id,)
        ).fetchall()
    return {r["key"]: r["value"] for r in rows}


def set(user_id: int, key: str, value: str) -> None:
    with _conn() as conn:
        conn.execute(
            "INSERT INTO user_prefs (user_id, key, value) VALUES (?, ?, ?)"
            " ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value",
            (user_id, key, value),
        )


init()
