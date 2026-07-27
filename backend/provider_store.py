"""User-added AI model configs (adapter + API key), stored in SQLite."""

from history import _conn


def init() -> None:
    with _conn() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS provider_configs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                kind TEXT NOT NULL,          -- 'stt' | 'tts'
                adapter TEXT NOT NULL,       -- e.g. 'deepgram', 'elevenlabs'
                label TEXT NOT NULL,
                api_key TEXT NOT NULL,
                model TEXT,                  -- adapter-specific: model id / voice id
                created_at REAL DEFAULT (unixepoch('now'))
            )
        """)


def add(kind: str, adapter: str, label: str, api_key: str, model: str | None) -> int:
    with _conn() as conn:
        cur = conn.execute(
            "INSERT INTO provider_configs (kind, adapter, label, api_key, model)"
            " VALUES (?, ?, ?, ?, ?)",
            (kind, adapter, label, api_key, model),
        )
        return cur.lastrowid


def list_configs(kind: str | None = None) -> list[dict]:
    with _conn() as conn:
        if kind:
            rows = conn.execute(
                "SELECT * FROM provider_configs WHERE kind = ? ORDER BY id", (kind,)
            ).fetchall()
        else:
            rows = conn.execute("SELECT * FROM provider_configs ORDER BY id").fetchall()
    return [dict(r) for r in rows]


def get(config_id: int) -> dict | None:
    with _conn() as conn:
        row = conn.execute(
            "SELECT * FROM provider_configs WHERE id = ?", (config_id,)
        ).fetchone()
    return dict(row) if row else None


def delete(config_id: int) -> None:
    with _conn() as conn:
        conn.execute("DELETE FROM provider_configs WHERE id = ?", (config_id,))


init()
