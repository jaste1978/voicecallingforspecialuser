# SunoSathi — Phase 1 Record

_July–August 2026 · Built by Tejas Langalia with Claude as the engineering
team · Production: sunosathi.com / app.sunosathi.com_

## What SunoSathi is

Deaf and hard-of-hearing people keep their own mobile number. They dial one
carrier code (**\*\*21\*07971442451#**) that forwards their calls to
SunoSathi's shared line. When someone calls them, the SunoSathi app rings,
shows the caller's words as live captions — Hindi, Gujarati, English and
Hinglish, auto-detected — and lets them reply three ways: speaking, typing
(spoken to the caller in a natural AI voice), or tapping picture tiles with
ready-made sentences. आपके कान, आपकी आवाज़।

## What shipped in Phase 1

### Core calling
- Live captioned incoming calls on the user's own number via carrier
  forwarding → Vobiz DID → streaming STT (Sarvam saaras:v3, auto language).
- Outbound calls from the app (contacts or any number) with captions.
- Reply by voice; **type-to-speak** (Sarvam Bulbul TTS, per-user voice
  choice, LRU-cached); **picture board** — 30 tiles across 5 categories
  speaking full sentences, for users who cannot speak or type mid-call.
- Adaptive noise gate: TV/traffic/crowd noise no longer becomes junk
  captions in random languages (EMA noise floor, attack/hangover windows,
  steady-loud reclassification).
- Script normalization: captions always render in Devanagari/Gujarati
  correctly even when the STT emits stray scripts.

### Trust and quality
- Every call is recorded (both legs), transcribed, and **self-scored**: live
  captions are compared against a full-context batch re-transcription and
  the call shows a caption-accuracy percentage. Scoring is script-blind
  (romanization + ISCII folding) so Latin vs Devanagari output scores fairly.
- Call history with full transcripts, per-call timelines, and audio playback.
- Company sentinel: an internal user line receives a synthetic end-to-end
  call every night at 03:30 IST (webhook → ring → accept → real TTS audio →
  live captions) and alerts on failure; morning brief and failed-call-streak
  monitor wired for Telegram.

### Multi-tenant platform
- One shared DID serves many users: calls are routed by the ForwardedFrom
  number to per-user lines with isolated rings, history, and contacts.
- Self-registration in the app with **admin approval** — approving activates
  the account and auto-links the user's number for routing.
- Admin console: Users & Numbers (with approval queue), live Call Monitor,
  per-call cost accounting (Sarvam STT/TTS + Vobiz, vendor-reported billing
  where available, editable rates), pilot waitlist, AI model management
  (pluggable STT/TTS providers).

### Apps and distribution
- **Android**: standalone APK with true background ringing (foreground
  service holding the ring socket; vibration + full notification with the
  app closed) — verified by emulator end-to-end against production.
  **Play Store closed testing live** (com.sunosathi.app, v1.4.1/vc5).
- **iOS**: native app **on TestFlight** (build 1.4.1); rings while open.
  Full headless build+sign+upload pipeline (API-key cloud signing).
- **PWA** at app.sunosathi.com — installable, always current.
- Self-updating clients: version watchdog reloads web bundles after deploys.
- Expo Go developer QR page for quick iPhone trials.

### Brand and presence
- Brand finalized: **सुनो, the listening mark** — master SVGs in `brand/`,
  every asset (app icons, favicons, store graphics, social) generated from
  them.
- sunosathi.com: SEO'd marketing site with live-caption demo animation,
  FAQ JSON-LD, feature list, privacy policy (Play/App Store compliant).
- 10-slide real-screenshot install guide at sunosathi.com/guide.
- In-app IA: Home / Calls / Contacts / Settings tabs, Help & FAQ (bilingual),
  Support page (WhatsApp-first), consistent proportionate type scale.

### Company operations (one-person + AI)
- Server-side watchdogs (night watch, morning brief, failure streaks) with
  Telegram delivery.
- Cost module tracking per-call vendor spend against editable rate cards.
- Invention disclosure drafted; feature inventory (FEATURES.md/.docx);
  GTM plan; tester-invite kits for both stores.

## Key engineering lessons kept

- Vobiz sends ForwardedFrom on forwarded calls — the entire multi-tenant
  model routes on it (Model A: shared DID, zero per-user rent).
- Caption quality complaints were script mismatches, not STT errors —
  score script-blind before blaming the model.
- Android 14+/targetSDK 36 requires foregroundServiceType at service start,
  not just in the manifest.
- iOS/Xcode breaks on spaces in project paths in three separate places —
  patched via patch-package + pbxproj edit (documented in git history).
- Python venvs bind absolute paths — after moving a project, launch via
  `venv/bin/python3 -m <tool>`, never the console scripts.
- Expo Go tunnels (ngrok) are fragile; Cloudflare quick tunnels are the
  reliable fallback; store distribution is the real fix.

## Where Phase 1 leaves the company

- Product: complete captioned-calling loop, production-stable, self-testing
  nightly, self-scoring per call.
- Distribution: Play closed testing (14-day/12-tester clock running),
  TestFlight live, PWA public.
- Pipeline: signup → admin approval → forwarding code → captioned calls,
  with only the approval tap manual.
- Next: **Phase 2 — launch, reliability, reach** (see PHASE-2.md).
