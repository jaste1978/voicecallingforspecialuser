# SunoSathi Roadmap

_Last updated: 29 Jul 2026_

## Cost optimization ladder (inbound ≈ ₹1.5/min all-in today)

**Rung 1 — code-level wins (~₹1.5 → ~₹0.7–0.8/min, no quality loss)**
- [ ] Smart quality-scoring: re-transcribe only every 5th call + any call that
      looks broken (zero captions, romanized rescue fired) instead of every call.
      Touch: `backend/call_session.py` (`quality.schedule` call site).
- [ ] Silence gating: only stream caller audio to STT when frames are loud
      (we already compute per-frame loudness in `_rescue_check`). Cuts billed
      STT minutes 30–50% on typical conversations.
      Touch: `backend/call_session.py` `vobiz_media`.

**Rung 2 — commercial (at ~50+ users)**
- [ ] Ask Vobiz for committed-use discount (advertised on their pricing page).
- [ ] Rate-card comparison: Exotel, Plivo, Ozonetel for India DID inbound.

**Rung 3 — self-hosted telephony (only at 1000s of users)**
- SIP trunk directly from an operator (Airtel/Tata/Jio Business):
  rental ~₹2–5k/month, inbound minutes ≈ free (calling-party-pays).
- FreeSWITCH/Asterisk answering calls, forking audio to our backend
  (replaces Vobiz's software layer; numbers still come from the operator —
  self-hosting the number itself is not legally possible in India).
- Self-hosted STT (AI4Bharat / Whisper family on GPU) → floor ≈ ₹0.10–0.15/min.
- ⚠️ Regulatory: PSTN↔internet telephony for third parties touches DoT
  licensing (VNO/OSP). Get telecom-legal advice before building this rung.

## Product roadmap

- [x] **Multi-tenant** — SHIPPED v0.15.0 (2026-07-30). Model A confirmed
      live: Vobiz sends ForwardedFrom on forwarded calls. Per-user lines
      (concurrent calls, isolated rings), number_map routing with admin
      /api/numbers CRUD, user-scoped history/contacts, per-user /api/me.
      Onboarding a pilot user = create user + register number + send the
      forward code. Remaining niceties: admin UI for users/numbers
      (API-only today), per-user provider prefs if ever needed. CHECK
      Vobiz channel limit on the shared DID before scaling users.

      **Original plan (2026-07-30).** Users keep their existing mobile number and
      call-forward it to a SunoSathi number (`**21*<did>#` = forward-all on
      GSM). Two routing models:
      - **Model A — shared DID:** many users forward to one DID; we route by
        the forwarded-from (diversion) number if Vobiz passes it in the
        answer webhook. Zero per-user DID rent. UNVERIFIED: v0.14.2 logs the
        full webhook payload + diversion-ish headers; test = forward
        9819095969 → 79714 42451, call it, read Railway logs.
      - **Model B — DID per user (reliable backbone):** each user gets a
        Vobiz DID, route by `To`. Works regardless of carrier behaviour;
        costs DID rent per user. Users may still forward their own number
        on top for the keep-your-number UX.
      Build order regardless of model: (1) `numbers` table mapping
      incoming number → user_id; (2) CallManager singleton → per-user line
      registry (concurrent calls, per-user browser sockets so only the
      owner's devices ring); (3) `user_id` on calls/contacts + migrate
      existing rows to Tejas + per-user APIs; (4) outbound uses the user's
      own DID as caller ID; (5) onboarding flow: create user → assign
      number → forwarding instructions.
- [ ] Reply to pilot signups (Jayesh — deaf user; Divyesh — BAPS developer).
- [ ] "Create user" UI in Admin (accounts currently created via API).
- [ ] Change-password UI.
- [ ] Type-to-speak during calls (Sarvam Bulbul TTS) — for users who can't
      speak; providers layer already supports TTS.
- [ ] Sound alerts (doorbell/alarm/horn → vibration + flash) — YAMNet
      in-browser; original phase-3 idea, never built.
- [ ] Translation bridge (caller speaks Hindi → captions in English).
- [ ] Proper Expo dev-build (background incoming-call push notifications;
      Expo Go can't do background).
- [ ] Logo (parked — brief: "classic + millennial + Indian"; see
      memory/logo-parked.md for rejected directions).
- [ ] Google Search Console + sitemap submission.
- [ ] Rotate keys that passed through chat: Sarvam, Vobiz token, admin key,
      Tejas's password.

## Current architecture snapshot (v0.11.1)

- sunosathi.com → marketing site (public, SEO'd, waitlist → SQLite)
- app.sunosathi.com → app (login required; admin role gates Models/Monitor/Waitlist)
- +91 79714 42451 → Vobiz → Railway backend → Sarvam saaras:v3 streaming
  (auto language, romanized rescue) → captions; recordings + auto quality
  score per call; observability funnel in Admin → Call Monitor.
- Providers pluggable: Sarvam (default), Deepgram + Google STT configured.
