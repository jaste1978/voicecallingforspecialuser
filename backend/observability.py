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


def _noanswer_note(reason: str) -> str:
    """Friendly label for a call the user never picked up — not a failure."""
    r = (reason or "").lower()
    if "busy" in r:
        return "line busy"
    if "declin" in r:
        return "declined"
    if "missed" in r:
        return "missed — no answer"
    if "cancel" in r:
        return "caller cancelled"
    if "hung up" in r:
        return "caller hung up before answer"
    return reason or "no answer"


def analyze(call: dict) -> dict:
    tl = call.get("timeline") or []
    stages: list[dict] = []

    def stage(name, ok, at_ms=None, note="", target=None):
        stages.append({
            "stage": name, "ok": bool(ok), "at_ms": at_ms,
            "note": note, "target_ms": target,
        })

    outbound = call.get("direction") == "out"
    reason = call.get("reason") or ""

    webhook = _find(tl, "incoming_call_webhook") or _find(tl, "outbound_dialing")
    stage("received", webhook is not None,
          webhook and webhook.get("t_ms"), "call reached the server")

    stream = _find(tl, "vobiz_stream_started")
    t_stream = stream and stream.get("t_ms")
    stage("media", stream is not None, t_stream,
          "" if stream else "audio stream never connected",
          STAGE_TARGETS_MS["media"])

    # Incoming ring: the app is reachable if ANY web screen (browser_sockets)
    # OR native ring device (background ring service) was connected when the
    # call rang. Older rows only logged `screens`, so a missing ring_devices
    # is treated as unknown, not zero.
    ring = ack = None
    reachable = None
    if not outbound:
        ring = _find(tl, "ring_sent") or _find(tl, "ring_browser")
        if ring is not None:
            screens = ring.get("screens")
            ring_dev = ring.get("ring_devices")
            # Only judge reachability when native-device data is present.
            # Old rows logged `screens` only; without ring_devices we cannot
            # tell if a native app was reachable, so leave it unknown.
            if ring_dev is not None:
                reachable = (screens or 0) + ring_dev
        note = ""
        if ring is None:
            note = "ring never sent"
        elif reachable == 0:
            note = "no app connected (web or native) when the call rang"
        stage("ring_sent", ring is not None and reachable != 0,
              ring and ring.get("t_ms"), note, STAGE_TARGETS_MS["ring_sent"])

        ack = _find(tl, "ring_ack")
        stage("ring_shown", ack is not None, ack and ack.get("t_ms"),
              "" if ack else "app did not confirm showing the ring",
              STAGE_TARGETS_MS["ring_shown"])

    answered = _find(tl, "user_accepted") or _find(tl, "outbound_answered")
    stage("answered", answered is not None,
          answered and answered.get("t_ms"),
          reason if answered is None else "")

    stt = cap = None
    if answered is not None:
        stt = _find(tl, "stt_connected")
        stage("stt", stt is not None, stt and stt.get("t_ms"),
              (stt or {}).get("provider", "") or "STT never connected",
              STAGE_TARGETS_MS["stt"])

        cap = _find(tl, "caption")
        stage("first_caption", cap is not None, cap and cap.get("t_ms"),
              "" if cap else "no captions in this call",
              STAGE_TARGETS_MS["first_caption"])

        rescue = _find(tl, "romanized_rescue")
        if rescue:
            stage("romanized_rescue", True, rescue.get("t_ms"),
                  "language unidentified — switched to as-it-sounds")

    ended = _find(tl, "call_ended")
    stage("ended", ended is not None, ended and ended.get("t_ms"), reason)

    # Verdict: judge by what actually mattered to the user, not telemetry gaps.
    if answered is None:
        # the user never picked up
        if not outbound and ring is not None and reachable == 0:
            # genuine miss: no app (web or native) was connected to ring
            verdict, verdict_note = "failed", "app not connected — call not shown"
        else:
            # normal: busy, declined, missed, or the caller gave up. Not a bug.
            verdict, verdict_note = "no_answer", _noanswer_note(reason)
    elif stream is None:
        verdict, verdict_note = "failed", "no audio after the call was answered"
    elif stt is None:
        verdict, verdict_note = "failed", "STT never connected"
    elif cap is None:
        verdict, verdict_note = "degraded", "answered but zero captions"
    else:
        verdict, verdict_note = "ok", ""

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
        "quality_score": call.get("quality_score"),
        "stages": stages,
    }
