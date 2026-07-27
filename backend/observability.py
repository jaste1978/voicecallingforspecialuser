"""Per-call stage analysis: derive a checkpoint funnel with pass/fail
verdicts against latency targets from each call's timeline."""

STAGE_TARGETS_MS = {
    "media": 2000,        # webhook -> stream connected
    "ring_sent": 500,     # stream -> ring pushed to screens
    "ring_shown": 2000,   # ring pushed -> app confirmed display
    "stt": 2500,          # accept -> STT session connected
    "first_caption": 6000,  # accept -> first caption (if caller spoke)
}


def _find(timeline: list[dict], event: str) -> dict | None:
    for e in timeline:
        if e.get("event") == event:
            return e
    return None


def analyze(call: dict) -> dict:
    tl = call.get("timeline") or []
    stages: list[dict] = []
    verdict = "ok"
    verdict_note = ""

    def stage(name, ok, at_ms=None, note="", target=None):
        stages.append({
            "stage": name, "ok": bool(ok), "at_ms": at_ms,
            "note": note, "target_ms": target,
        })

    webhook = _find(tl, "incoming_call_webhook") or _find(tl, "outbound_dialing")
    stage("received", webhook is not None,
          webhook and webhook.get("t_ms"), "call reached the server")

    stream = _find(tl, "vobiz_stream_started")
    t_stream = stream and stream.get("t_ms")
    ok_stream = stream is not None and (t_stream or 0) <= STAGE_TARGETS_MS["media"]
    stage("media", stream is not None, t_stream,
          "" if stream else "audio stream never connected",
          STAGE_TARGETS_MS["media"])
    if stream is None:
        verdict, verdict_note = "failed", "no media stream from Vobiz"

    outbound = call.get("direction") == "out"
    if not outbound:
        ring = _find(tl, "ring_sent") or _find(tl, "ring_browser")
        screens = (ring or {}).get("screens")
        ring_ok = ring is not None and (screens is None or screens > 0)
        note = ""
        if ring is None:
            note = "ring never sent"
        elif screens == 0:
            note = "app was not connected — nobody could see this call"
        stage("ring_sent", ring_ok, ring and ring.get("t_ms"), note,
              STAGE_TARGETS_MS["ring_sent"])
        if ring is not None and screens == 0 and verdict == "ok":
            verdict, verdict_note = "failed", "app not connected at ring time"

        ack = _find(tl, "ring_ack")
        stage("ring_shown", ack is not None, ack and ack.get("t_ms"),
              "" if ack else "app never confirmed showing the ring",
              STAGE_TARGETS_MS["ring_shown"])
        if ack is None and ring_ok and verdict == "ok":
            verdict, verdict_note = "degraded", "ring sent but never confirmed on screen"

    answered = _find(tl, "user_accepted") or _find(tl, "outbound_answered")
    reason = call.get("reason") or ""
    stage("answered", answered is not None,
          answered and answered.get("t_ms"),
          reason if answered is None else "")

    if answered is not None:
        stt = _find(tl, "stt_connected")
        stage("stt", stt is not None, stt and stt.get("t_ms"),
              (stt or {}).get("provider", "") or "STT never connected",
              STAGE_TARGETS_MS["stt"])
        if stt is None and verdict == "ok":
            verdict, verdict_note = "failed", "STT never connected"

        cap = _find(tl, "caption")
        stage("first_caption", cap is not None, cap and cap.get("t_ms"),
              "" if cap else "no captions in this call",
              STAGE_TARGETS_MS["first_caption"])
        if cap is None and verdict == "ok":
            verdict, verdict_note = "degraded", "answered but zero captions"

        rescue = _find(tl, "romanized_rescue")
        if rescue:
            stage("romanized_rescue", True, rescue.get("t_ms"),
                  "language unidentified — switched to as-it-sounds")

    ended = _find(tl, "call_ended")
    stage("ended", ended is not None, ended and ended.get("t_ms"), reason)

    caption_latencies = [
        e["after_speech_end_ms"] for e in tl
        if e.get("event") == "caption" and isinstance(e.get("after_speech_end_ms"), int)
    ]
    median = sorted(caption_latencies)[len(caption_latencies) // 2] if caption_latencies else None

    return {
        "id": call.get("id"),
        "call_uuid": call.get("call_uuid"),
        "from_number": call.get("from_number"),
        "direction": call.get("direction", "in"),
        "started_at": call.get("started_at"),
        "duration_s": call.get("duration_s"),
        "answered": call.get("answered"),
        "reason": reason,
        "verdict": verdict,
        "verdict_note": verdict_note,
        "captions": len(call.get("transcript") or []),
        "caption_latency_median_ms": median,
        "stages": stages,
    }
