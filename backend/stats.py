"""Admin dashboard: every number the product has, all-time and by window.

Read-only over the same SQLite file as history/auth. Synthetic sentinel
calls are excluded everywhere except the "sentinel" block. ISL Contribute
numbers come from its public /api/stats and are cached for five minutes so a
dashboard refresh never hammers the other service.
"""
from __future__ import annotations

import logging
import os
import sqlite3
import statistics
import time
from datetime import datetime, timedelta, timezone

import httpx

import costs as costs_mod
import history

logger = logging.getLogger("stats")
IST = timezone(timedelta(hours=5, minutes=30))
SENTINEL_EMAIL = "sentinel@internal.sunosathi"
CONTRIBUTE_STATS_URL = os.environ.get(
    "CONTRIBUTE_STATS_URL", "https://contribute.sunosathi.com/api/stats")

_contrib_cache: dict = {"at": 0.0, "data": None}


def _ist(ts: float | None) -> str | None:
    if not ts:
        return None
    return datetime.fromtimestamp(ts, IST).strftime("%d %b %Y, %H:%M")


def _count(conn: sqlite3.Connection, table: str, where: str = "1") -> int | None:
    try:
        return conn.execute(f"SELECT COUNT(*) FROM {table} WHERE {where}").fetchone()[0]
    except sqlite3.OperationalError:
        return None  # table does not exist on this deployment


def _window(conn: sqlite3.Connection, ex: str, since: float, rates: dict) -> dict:
    rows = conn.execute(
        f"""SELECT answered_at, ended_at, quality_score, user_id, tts_chars,
                   vobiz_cost, bill_duration, direction
            FROM calls WHERE {ex} AND started_at >= ?""", (since,)).fetchall()
    answered = [r for r in rows if r["answered_at"] is not None]
    scores = [r["quality_score"] for r in answered if r["quality_score"] is not None]
    minutes = sum(((r["ended_at"] or r["answered_at"]) - r["answered_at"]) for r in answered) / 60
    spend = 0.0
    for r in rows:
        dur = int((r["ended_at"] or r["answered_at"]) - r["answered_at"]) if r["answered_at"] else 0
        spend += costs_mod.call_cost({
            "duration_s": dur, "answered": r["answered_at"] is not None,
            "quality_score": r["quality_score"], "tts_chars": r["tts_chars"],
            "vobiz_cost": r["vobiz_cost"], "bill_duration": r["bill_duration"],
            "direction": r["direction"],
        }, rates)["total"]
    return {
        "calls": len(rows),
        "answered": len(answered),
        "missed": len(rows) - len(answered),
        "users": len({r["user_id"] for r in answered if r["user_id"] is not None}),
        "minutes": round(minutes, 1),
        "avg_quality": round(statistics.fmean(scores)) if scores else None,
        "median_quality": round(statistics.median(scores)) if scores else None,
        "spend": round(spend, 2),
    }


def _db_part() -> dict:
    now = time.time()
    today0 = datetime.now(IST).replace(hour=0, minute=0, second=0, microsecond=0).timestamp()
    rates = costs_mod.get_rates()
    with history._conn() as conn:
        conn.row_factory = sqlite3.Row
        sent_ids = [r[0] for r in conn.execute(
            "SELECT id FROM users WHERE email = ?", (SENTINEL_EMAIL,))]
        ex = "COALESCE(user_id, -1) NOT IN (%s)" % (",".join(map(str, sent_ids)) or "-1")
        # synthetic calls that landed before the sentinel user existed
        ex += " AND COALESCE(from_number, '') NOT IN ('0000000001', '0000000002')"

        # ---- users ----
        urow = conn.execute(
            f"""SELECT COUNT(*) total,
                       SUM(COALESCE(status,'active')='active') active,
                       SUM(COALESCE(status,'active')='pending') pending,
                       SUM(COALESCE(status,'active')='rejected') rejected,
                       SUM(role='admin') admins,
                       SUM(COALESCE(created_at,0) >= ?) new_7d,
                       SUM(COALESCE(created_at,0) >= ?) new_30d,
                       MIN(NULLIF(created_at,0)) first
                FROM users WHERE email != ?""",
            (now - 7 * 86400, now - 30 * 86400, SENTINEL_EMAIL)).fetchone()
        users = dict(urow)
        users["first_signup"] = _ist(users.pop("first"))
        users["with_number"] = conn.execute(
            "SELECT COUNT(DISTINCT user_id) FROM numbers WHERE user_id NOT IN (%s)"
            % (",".join(map(str, sent_ids)) or "-1")).fetchone()[0]
        users["with_calls"] = conn.execute(
            f"SELECT COUNT(DISTINCT user_id) FROM calls WHERE {ex} AND answered_at IS NOT NULL"
        ).fetchone()[0]
        numbers = [dict(r) for r in conn.execute(
            "SELECT kind, COUNT(*) n FROM numbers WHERE user_id NOT IN (%s) GROUP BY kind"
            % (",".join(map(str, sent_ids)) or "-1"))]

        # ---- calls, all time ----
        allw = _window(conn, ex, 0, rates)
        scores = [r[0] for r in conn.execute(
            f"SELECT quality_score FROM calls WHERE {ex} AND quality_score IS NOT NULL")]
        crow = conn.execute(
            f"SELECT MIN(started_at) f, MAX(started_at) l, SUM(COALESCE(tts_chars,0)) tts "
            f"FROM calls WHERE {ex}").fetchone()
        allw.update({
            "first_call": _ist(crow["f"]), "last_call": _ist(crow["l"]),
            "scored": len(scores),
            "min_quality": min(scores) if scores else None,
            "max_quality": max(scores) if scores else None,
            "p25_quality": round(statistics.quantiles(scores, n=4)[0]) if len(scores) >= 4 else None,
            "tts_chars": crow["tts"] or 0,
        })

        windows = {
            "today": _window(conn, ex, today0, rates),
            "7d": _window(conn, ex, now - 7 * 86400, rates),
            "30d": _window(conn, ex, now - 30 * 86400, rates),
        }

        by_month = [dict(r) for r in conn.execute(
            f"""SELECT strftime('%Y-%m', started_at, 'unixepoch', '+5 hours', '+30 minutes') month,
                       COUNT(*) calls, SUM(answered_at IS NOT NULL) answered,
                       ROUND(AVG(quality_score)) avg_quality,
                       COUNT(DISTINCT CASE WHEN answered_at IS NOT NULL THEN user_id END) users,
                       ROUND(SUM(CASE WHEN answered_at IS NOT NULL
                                 THEN COALESCE(ended_at,answered_at)-answered_at ELSE 0 END)/60.0, 1) minutes
                FROM calls WHERE {ex} GROUP BY 1 ORDER BY 1""")]

        days = []
        for i in range(13, -1, -1):
            d0 = today0 - i * 86400
            r = conn.execute(
                f"""SELECT COUNT(*) calls, SUM(answered_at IS NOT NULL) answered,
                           ROUND(AVG(quality_score)) avg_quality
                    FROM calls WHERE {ex} AND started_at >= ? AND started_at < ?""",
                (d0, d0 + 86400)).fetchone()
            days.append({"day": datetime.fromtimestamp(d0, IST).strftime("%d %b"),
                         "calls": r["calls"], "answered": r["answered"] or 0,
                         "avg_quality": r["avg_quality"]})

        languages = [dict(r) for r in conn.execute(
            f"""SELECT COALESCE(NULLIF(language,''),'unknown') language, COUNT(*) n
                FROM calls WHERE {ex} AND answered_at IS NOT NULL GROUP BY 1 ORDER BY 2 DESC""")]
        direction = [dict(r) for r in conn.execute(
            f"SELECT COALESCE(direction,'in') direction, COUNT(*) n FROM calls WHERE {ex} GROUP BY 1")]
        miss_reasons = [dict(r) for r in conn.execute(
            f"""SELECT COALESCE(NULLIF(reason,''),'unknown') reason, COUNT(*) n
                FROM calls WHERE {ex} AND answered_at IS NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 8""")]
        top_users = [dict(r) for r in conn.execute(
            f"""SELECT c.user_id, u.name, COUNT(*) calls,
                       ROUND(SUM(COALESCE(c.ended_at,c.answered_at)-c.answered_at)/60.0,1) minutes,
                       ROUND(AVG(c.quality_score)) avg_quality, MAX(c.started_at) last
                FROM calls c LEFT JOIN users u ON u.id = c.user_id
                WHERE {ex} AND c.answered_at IS NOT NULL
                GROUP BY c.user_id ORDER BY calls DESC LIMIT 8""")]
        for u in top_users:
            u["last"] = _ist(u.pop("last"))

        # ---- sentinel (synthetic night-watch calls) ----
        srow = conn.execute(
            """SELECT COUNT(*) runs, SUM(answered_at IS NOT NULL) ok, MAX(started_at) last
               FROM calls WHERE COALESCE(user_id,-1) IN (%s) OR from_number = '0000000002'"""
            % (",".join(map(str, sent_ids)) or "-1")).fetchone()
        last_ok = None
        if srow["last"]:
            last_ok = conn.execute(
                """SELECT answered_at IS NOT NULL FROM calls
                   WHERE COALESCE(user_id,-1) IN (%s) OR from_number = '0000000002'
                   ORDER BY started_at DESC LIMIT 1"""
                % (",".join(map(str, sent_ids)) or "-1")).fetchone()[0]
        sentinel = {"runs": srow["runs"], "ok": srow["ok"] or 0,
                    "last_run": _ist(srow["last"]), "last_ok": bool(last_ok) if last_ok is not None else None}

        # ---- other tables, if present on this deployment ----
        other = {
            "contacts": _count(conn, "contacts"),
            "waitlist": _count(conn, "waitlist"),
            "support_messages": _count(conn, "messages"),
            "call_feedback": _count(conn, "call_feedback"),
            "deletion_requests": _count(conn, "deletion_requests"),
            "telegram_linked": _count(conn, "telegram_links"),
        }
        other = {k: v for k, v in other.items() if v is not None}

    return {
        "generated_at": _ist(now),
        "users": users, "numbers": numbers,
        "calls": allw, "windows": windows,
        "by_month": by_month, "by_day": days,
        "languages": languages, "direction": direction, "miss_reasons": miss_reasons,
        "top_users": top_users, "sentinel": sentinel, "other": other,
        "rates": rates,
    }


async def _contribute() -> dict | None:
    if time.time() - _contrib_cache["at"] < 300 and _contrib_cache["data"] is not None:
        return _contrib_cache["data"]
    try:
        async with httpx.AsyncClient(timeout=4) as cx:
            r = await cx.get(CONTRIBUTE_STATS_URL)
            r.raise_for_status()
            data = r.json()
    except Exception as exc:  # the dashboard must still render without it
        logger.warning("contribute stats unavailable: %s", exc)
        data = _contrib_cache["data"]
    _contrib_cache.update(at=time.time(), data=data)
    return data


async def compute() -> dict:
    out = _db_part()
    out["contribute"] = await _contribute()
    return out
