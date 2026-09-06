# SunoSathi — Phase 3: The Sign Layer

_Drafted 7 Sep 2026 · Owner: Tejas · Builder: Claude_
_Decision: no 3D avatars, no video rendering in v1 — comprehension speed
over fancy. Two tracks run in parallel._

## Why

A large share of deaf Indians are sign-first with limited Hindi/English
text literacy. Live captions — our core product — do not serve them. The
sign layer makes SunoSathi understandable to the users who need it most.

## Track A — Picture Captions (चित्र मोड) · ships in weeks

The receiving-side twin of the picture board. During a call, below the
captions, a strip of large 2D cards shows the MEANING of what the caller
said: "कल शादी में आ रहे हो?" → [कल 📅] [शादी 💍] [आना →🏠] [?]. Each card
is brand-styled line artwork + the Hindi word.

- **Concept dictionary ~300 entries**, chosen from OUR real call
  transcripts (not guesses). Caption text → dictionary match → cards.
  Instant, zero added latency, zero per-minute cost, renders client-side.
- **ISL-informed artwork**: for the ~100 most common signs (family,
  numbers, greetings, yes/no, come/go, food, money, doctor) the card IS a
  static drawing of the ISL sign (ISLRTC dictionary as reference).
  Everything else: clear pictograms (seed from OpenMoji, restyle to brand).
- Settings toggle per user; GA events tell us who keeps it on.
- Also plays on the test call → every new user sees it in 30 seconds.
- **Architecture rule: the renderer is swappable.** Anything that turns
  caption text into "meaning on screen" (cards today, generated signing
  later) sits behind one interface. Track B plugs into this socket.

## Track B — Our own sign-generation AI · research, runs in its own chat

Live voice→ISL generation does not exist to buy (no vendor, no API; the
closest, Signapse UK, only pre-renders fixed announcements). ISL is
data-poor. So we build the data flywheel ourselves:

1. **Capture tooling — built as a PUBLIC contribution platform**
   (decision 7 Sep 2026): sunosathi.com/contribute. Anyone — NGO members,
   deaf signers, interpreters — is shown a phrase (top-300 list from
   Track A), records ~3s on their phone camera, MediaPipe Holistic
   extracts pose keypoints in the browser (hands + face + body) →
   phrase→pose-sequence dataset. Common Voice model, for ISL.
   Non-negotiables: explicit bilingual CONSENT per contribution (data
   trains SunoSathi's sign AI — stored with each recording), a review
   queue where fluent signers approve/vote (NGO partners as reviewers),
   multiple recordings per phrase (regional ISL variation is a feature,
   capture it), contributor credit wall (opt-in names), Turnstile
   protection (already live on the domain).
2. **Pose playback renderer**: replay captured keypoints as a clean 2D
   line-figure animation in-app (brand-styled, tiny files, natural human
   motion without 3D rigging or video). This alone beats static cards for
   common phrases and produces training data as a side effect.
3. **Model**: seq2seq text/gloss → pose-sequence (small transformer,
   restricted call domain first). Trainable on our own captured data once
   we have a few thousand phrase recordings. Facial grammar (eyebrows =
   question) captured by MediaPipe face landmarks — must be preserved.
4. **Pre-generated signing for fixed content** (test call script, guide,
   onboarding) — latency doesn't matter when the script is known.

Needs from Tejas: an ISL signer to record with (person + consent), a
phone/camera. NGO/deaf-association contact doubles as discovery.

## Sequence

- Track A MVP: ~1–2 weeks alongside Phase-2 launch work.
- Track B: capture tooling first (1 week), then recordings drive
  everything; model training only after data exists.
- Discovery interviews (5 sign-first users) validate both tracks.

## Explicitly NOT in Phase 3 v1

- 3D avatars, generative video, live sign→speech recognition (research
  frontier; a ~20-sign command vocabulary via pose estimation may come
  later).
