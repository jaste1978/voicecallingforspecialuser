"""Per-call cost accounting.

Usage quantities are measured (call seconds, TTS characters, Vobiz's own
billed cost from its hangup webhook); rates are admin-editable so the
numbers track real vendor pricing. All amounts in INR.
"""

from history import _conn

# Editable defaults — adjust in Admin > Costs to match vendor invoices.
DEFAULT_RATES = {
    "sarvam_stt_per_min": 0.50,    # streaming saaras captions, per audio minute
    "sarvam_batch_per_min": 0.50,  # post-call quality re-transcription
    "sarvam_tts_per_1k_chars": 1.00,  # Bulbul type-to-speak & prompts
    "vobiz_in_per_min": 0.60,      # inbound leg (used when Vobiz reports 0)
    "vobiz_out_per_min": 0.80,     # outbound leg
}


def init() -> None:
    with _conn() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS cost_rates (
                key TEXT PRIMARY KEY,
                value REAL
            )
        """)


def get_rates() -> dict:
    with _conn() as conn:
        rows = conn.execute("SELECT key, value FROM cost_rates").fetchall()
    rates = dict(DEFAULT_RATES)
    rates.update({r["key"]: r["value"] for r in rows if r["key"] in DEFAULT_RATES})
    return rates


def set_rates(updates: dict) -> dict:
    with _conn() as conn:
        for k, v in updates.items():
            if k in DEFAULT_RATES:
                try:
                    conn.execute(
                        "INSERT INTO cost_rates (key, value) VALUES (?, ?)"
                        " ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                        (k, float(v)),
                    )
                except (TypeError, ValueError):
                    pass
    return get_rates()


def call_cost(call: dict, rates: dict) -> dict:
    """Break one history row into cost components."""
    minutes = (call.get("duration_s") or 0) / 60
    answered = bool(call.get("answered"))
    stt = minutes * rates["sarvam_stt_per_min"] if answered else 0.0
    batch = (
        minutes * rates["sarvam_batch_per_min"]
        if answered and call.get("quality_score") is not None else 0.0
    )
    tts = (call.get("tts_chars") or 0) / 1000 * rates["sarvam_tts_per_1k_chars"]
    reported = call.get("vobiz_cost")
    if reported is not None and reported > 0:
        vobiz = reported
    else:
        rate = rates["vobiz_out_per_min"] if call.get("direction") == "out" else rates["vobiz_in_per_min"]
        billed_min = (call.get("bill_duration") or 0) / 60 or minutes
        vobiz = billed_min * rate if answered else 0.0
    total = stt + batch + tts + vobiz
    return {
        "stt": round(stt, 3), "batch": round(batch, 3),
        "tts": round(tts, 3), "vobiz": round(vobiz, 3),
        "total": round(total, 3),
        "vobiz_reported": reported is not None and reported > 0,
    }


init()
