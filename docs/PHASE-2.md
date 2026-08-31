# SunoSathi — Phase 2 Plan

_Drafted 30 Aug 2026 · Owner: Tejas · Builder: Claude_

## Where Phase 1 ended

Shipped and live: captioned calls on the user's own number (Hindi / Gujarati /
English / Hinglish, auto-detected), reply by voice / type-to-speak / picture
board, multi-tenant routing, self-registration with admin approval, Android
app in Play closed testing, iOS app in TestFlight, PWA, background ringing on
Android, noise gate, per-call quality scores, cost accounting, night-watch
sentinel, brand + website + guide + privacy policy.

## Phase 2 theme

**Launch, reliability, and reach.** Phase 1 proved the product works. Phase 2
gets it into strangers' hands (store launches), makes sure it never misses a
call (iOS ringing, notifications), and removes every manual step between "I
signed up" and "my calls are captioned."

---

## Workstreams

### P0 — Launch blockers (weeks 1–3)

**1. Play Store production release**
- Run the 14-day closed test with 12+ testers (in progress).
- Apply for production access, fix anything Google raises.
- Production listing polish: final screenshots from v0.26 UI, localized
  listing (Hindi).
- _Effort: mostly waiting + 1 day of fixes._

**2. App Store public release**
- TestFlight external group + public link (one-time Beta review).
- App Store listing: screenshots (6.7" + 5.5"), description, keywords,
  accessibility declarations. App Review notes with the demo login.
- Expect one round of App Review questions (mic + calling app); answers
  largely exist from the Play data-safety work.
- _Effort: 1–2 days + review wait._

**3. Onboarding automation — approve → notify → forward**
- On approval, auto-send the setup message (forwarding code, login link)
  via WhatsApp deep link the admin taps, or fully automatic via email.
- Requires the email provider below; WhatsApp Business API is out of scope
  (cost/verification) — manual WhatsApp send stays as the personal touch.
- In-app onboarding checklist after first login: ① account approved
  ② dial forwarding code ③ take a test call (button stages a sentinel-style
  self-call so the user sees captions instantly without a second phone).
- _Effort: 2–3 days. The self-test call is the single highest-value
  onboarding feature — it turns "did it work?" into a 30-second demo._

**4. Email service + OTP + password reset**
- Wire Resend/Brevo free tier (needs account + API key from Tejas).
- Signup email OTP (6-digit), password reset flow ("forgot password" is
  currently a WhatsApp-to-Tejas event), approval notification email.
- Change-password UI in Settings; rotate the flagged credentials.
- _Effort: 2 days._

### P1 — Never miss a call (weeks 3–6)

**5. iOS background ringing (CallKit + VoIP push)**
- The big one. Today iOS rings only with the app open.
- Server: APNs VoIP push (PushKit) on incoming call → iOS wakes the app →
  CallKit native ring screen → accept opens SunoSathi captions.
- Needs: APNs key from the Apple developer account, push token registry
  per user/device, native module work in the Expo dev-client build.
- Deliverable: iPhone rings like a real phone call even when app is closed.
- _Effort: 1–2 weeks including device testing. Highest engineering risk in
  Phase 2 — schedule early, ship behind a per-user flag._

**6. Android ring reliability hardening**
- Auto-restart the ring service after device reboot (BOOT_COMPLETED exists,
  verify end-to-end), Doze-mode testing, battery-optimization exemption
  prompt with a plain-language explanation screen.
- Missed-call push summary: if a call rings 30s unanswered → notification
  "You missed a call from X" (currently only visible in history).
- _Effort: 3–4 days._

**7. Cost optimization rung 1** (from the roadmap ladder)
- Silence gating: stream caller audio to STT only when loud (loudness data
  already computed). Cuts billed STT minutes 30–50%.
- Smart quality re-scoring: batch re-transcribe only every 5th call plus
  any call that looks broken, instead of every call.
- Target: inbound all-in cost from ~₹1.5/min toward ~₹0.8/min.
- _Effort: 2–3 days including a week of A/B monitoring via the sentinel._

### Shipped early — 30 Aug 2026

**Sathi-to-Sathi calls (v0.28.0)** — app-to-app calls addressed by Sathi ID
(@handle), no phone number, no telephony cost. Both-direction live captions,
instant typed text (💬) and picture board, audio relayed in-process, Android
background ring works, history on both sides. This makes SunoSathi a network:
deaf-to-deaf calls where each person uses whatever channel they have.

### Testing infrastructure (added 31 Aug 2026)

**Virtual user fleet** (`scrt/sathi_fleet.py`, gitignored — contains admin
creds): N simulated users register on production, get auto-approved, make
N/2 simultaneous Sathi calls with unique TTS speech + typed messages,
measure ring/answer/caption latencies and accuracy, then delete themselves
(admin DELETE /api/users/{id}, v0.29.1). Baseline 31 Aug: 5 concurrent
calls — ring 65-67ms flat, answer 0.6-1.0s, first caption 0.9s (1 call) to
3.4s (5th concurrent call; STT session contention is the scaling frontier).
All captions word-accurate. Cheaper and more honest than device farms for
multi-user testing; farms can't test SIM forwarding or mic anyway.

### P2 — Delight and reach (weeks 6–10)

**8. Sound alerts** (original phase-3 idea, promoted)
- Doorbell / alarm / horn / baby crying detected on-device (YAMNet in the
  browser/WebView) → vibration + full-screen flash + notification.
- Works outside calls — makes SunoSathi useful all day, not only during
  calls. Strong differentiator, fully on-device (no cost per minute).
- _Effort: 1 week including tuning against Indian household sounds._

**9. Translation bridge**
- Caller speaks Hindi → captions in English (or vice versa), per-user
  preference. Sarvam translate API slots into the existing caption path.
- _Effort: 2–3 days behind a Settings toggle._

**10. Language & UI reach**
- Marathi / Tamil / Telugu / Bengali caption support (saaras auto-detect
  already emits these — validate quality, extend script normalization).
- App UI strings in Hindi and Gujarati (currently English-first with
  bilingual accents).
- _Effort: 3–4 days._

**11. Sign-language discovery track** (research, not build)
- Interview 5 sign-first users (ISL) from the pilot; test whether captions
  + picture board suffice or an ISL avatar layer is needed.
- Output: a one-page go/no-go for an ISL interpreter feature in Phase 3.
- _Effort: ongoing alongside pilot support._

### Standing items (whole phase)

- Key rotation (Sarvam, Vobiz, admin key, personal password) — do during
  the email-service work when password reset ships.
- Sentinel expansion: nightly check should also exercise type-to-speak and
  the new push path once built.
- Weekly cost + quality brief via Telegram (extend existing morning brief).
- Google Search Console + sitemap (10-minute task, still pending).

---

## Sequence at a glance

| Weeks | Focus |
|---|---|
| 1–3 | Store launches, onboarding automation, email/OTP |
| 3–6 | iOS CallKit ringing, Android hardening, cost rung 1 |
| 6–10 | Sound alerts, translation, languages, ISL discovery |

Dependencies: everything in P0 is independent and can start now. CallKit
(5) needs an APNs key from the Apple account (Tejas, 5 minutes). Email
work (3, 4) needs a Resend/Brevo account (Tejas, 5 minutes).

## Success metrics (end of Phase 2)

- Both stores: public listings live, installable by anyone.
- ≥ 25 approved real users; ≥ 10 weekly-active.
- Missed-call rate on active users < 5% (measured via monitor).
- iOS users receive calls with the app closed (CallKit live).
- Inbound cost ≤ ₹0.9/min all-in.
- Zero manual steps from signup to first captioned call except the
  admin-approval tap.

## Explicitly NOT in Phase 2

- Android default-dialer "Lite mode" (parked — see ROADMAP.md).
- WhatsApp Business API automation (cost/verification overhead).
- Self-hosted telephony / STT (roadmap rung 3 — only at 1000s of users).
- ISL avatar interpreter build (Phase 3 pending discovery outcome).
