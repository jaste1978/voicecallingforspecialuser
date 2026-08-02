# Invention Disclosure — SunoSathi (सुनोसाथी)

**Prepared for:** Patent attorney consultation (India, Computer-Related Inventions)
**Inventor:** Tejas Langalia (tnlangalia@gmail.com)
**Assignee (intended):** SunoSathi / to be determined
**Date of disclosure:** 2 August 2026
**Development timeline evidence:** Private git repository, 78 dated commits, 26 July 2026 – 2 August 2026 (first working system deployed to production 27 July 2026; system in continuous production use at sunosathi.com since)

---

## 1. Title

**A telephony system enabling deaf, hard-of-hearing and non-speaking persons to conduct ordinary phone calls on their existing phone numbers, using live multilingual captioning with integrity assurance and synthesized typed/pictographic speech.**

---

## 2. Field of the invention

Assistive telecommunication; real-time speech-to-text and text-to-speech integration with the public switched telephone network (PSTN); multi-tenant cloud telephony routing; augmentative and alternative communication (AAC).

---

## 3. Problem addressed

Approximately 63 million Indians are deaf or hard of hearing. An ordinary phone call — from family, a bank, a delivery agent, a doctor — is inaccessible to them. Existing accommodations fail in the Indian context:

- Captioned-telephony services (US CapTel/IP-CTS model) require dedicated devices or government-funded human relay infrastructure that does not exist in India.
- Smartphone caption features (e.g., Google Live Caption) are device-locked, English-centric, perform poorly on Indic languages and code-mixed speech ("Hinglish"), and offer no voice path for non-speaking users.
- All existing approaches require the user to adopt a new number or app-to-app calling; the user's existing SIM number — the identity their family and services already know — stays inaccessible.

## 4. Summary of the system (production implementation)

The deployed system comprises: a cloud telephony ingress (DID number with programmable answer webhook and bidirectional 16 kHz PCM media stream over WebSocket); a per-user call-line registry; a streaming speech-to-text engine (Indic multilingual, auto language identification); a caption-integrity pipeline; a text-to-speech return path; and end-user applications (web/PWA, Android with background ring service) presenting live captions and typed/pictographic reply surfaces.

A user forwards their existing mobile number to the system's shared DID (standard carrier code `**21*<DID>#`). Calls to their own number ring their app with live captions; they reply by voice, typed text, or picture tiles rendered as synthesized speech to the caller.

---

## 5. Candidate inventions (technical contributions)

### Invention A — Multi-tenant accessible telephony over carrier call-forwarding with forwarded-party routing

**The technical problem:** serving many users on one telephony ingress while each keeps their *existing* phone number, without per-user DID provisioning, SIM replacement, number porting, or caller-side changes.

**The method (implemented 30 July 2026, `backend/number_map.py`, `backend/call_session.py`):**

1. Each user registers the mobile number(s) they forward (stored normalized to a 10-digit national key in a number→user mapping table).
2. On an inbound call, the telephony provider's answer webhook carries the field `ForwardedFrom` when the call arrived via carrier forwarding. The system resolves, in order: (a) `ForwardedFrom` against registered forwarded numbers; (b) the dialed `To` number against dedicated per-user DIDs; (c) a default line, preserving service for unmatched calls.
3. The resolved user's "line" object — holding that user's connected app sockets (screen sockets carrying audio+events, and separate event-only "ring channel" sockets for battery-cheap background alerting) — receives the ring; other users' lines are unaffected. Concurrent calls for different users proceed independently over the same shared DID.
4. Media-stream WebSockets are correlated to lines by call-UUID at stream start; hangup callbacks and answer-URL re-fetches (keep-alive re-invocations) are disambiguated by UUID with a recently-ended set to suppress ghost re-ringing.
5. Ring delivery is gated on media-stream establishment ("ring-on-stream"), guaranteeing the user can never answer a call whose audio path is dead.

**Technical effects:** (i) N users served per single DID — resource use decoupled from user count; (ii) zero caller-side and zero SIM-side change — accessibility as a property added *to the user's existing number*; (iii) verified sub-second ring delivery (measured 524 ms dial-to-screen in production); (iv) per-user isolation of rings, captions, audio and history on shared infrastructure.

**Novelty position:** captioned telephony services conventionally assign the user a new number or operate app-to-app. Using the carrier forwarded-party signal as the *tenant-routing key* for an accessibility relay, combined with ring-on-stream and event-only background ring channels, is to the inventor's knowledge not practiced in existing services.

### Invention B — Caption-integrity pipeline for low-resource multilingual telephony (noise gating + accuracy-first flushing + automatic self-scoring)

**The technical problem:** streaming STT on Indian telephone audio hallucinate text from ambient noise; auto language identification on short utterances emits random languages and scripts; eager partial results produce garbled captions; and no deployed captioning system measures its own per-call accuracy.

**The method (implemented 27 July – 2 August 2026, `backend/call_session.py`, `backend/sarvam_relay.py`, `backend/quality.py`):**

1. **Adaptive noise gate before STT.** Per call, an energy squelch learns the ambient floor (EMA of sub-threshold frames); only speech-like audio (level > max(fixed floor, adaptive floor × factor), 2-frame attack) reaches the recognizer. Non-speech is replaced by *equal-length silence frames*, preserving stream cadence and the recognizer's voice-activity end-pointing. A pre-roll buffer (240 ms) is replayed on gate opening so word onsets survive; a hangover (700 ms) bridges word gaps; an unbroken loud run ≥10 s — impossible for natural speech, characteristic of machinery/TV — is reclassified as noise and learned into the floor, while speech louder than that noise still passes. The user's ear-path and the archival recording receive the raw, ungated audio.
2. **Accuracy-first finalization.** Captions are emitted at recognizer voice-activity boundaries (natural phrase ends), with a forced flush only after ≥6 s of continuous speech — trading small latency (measured median 115–190 ms after speech end) for phrase-coherent, high-accuracy captions, in contrast to eager partial emission.
3. **Escalation on caption failure ("romanized rescue").** If ≥8 s of *gate-approved* speech yields zero captions, the recognizer is live-switched to phonetic transliteration mode mid-call, so unidentifiable speech is still rendered readably as sounds; noise cannot trigger the escalation because only gated speech is counted.
4. **Per-call automatic self-scoring.** After every answered call, the archival raw recording is re-transcribed by a batch full-context model; the live captions are scored against it by symmetric normalized word edit distance under a *script-blind* comparison: all nine ISCII-parallel Indic scripts are folded positionally onto one script, romanized, and matched fuzzily, so "ਹਾਂ"="હાં"="हां" are equal and cross-script output is not falsely penalized. The score is stored per call and surfaced in monitoring, giving a continuously self-measuring captioning service.
5. **Readable-script normalization at display.** Any caption emitted in an Indic script outside the user's readable set is positionally mapped (per the parallel ISCII block layout) into a readable script before display and at history read-time.

**Technical effects:** hallucinated captions from ambient noise eliminated (verified: sustained street/TV noise produces zero captions while speech over the same noise is captioned); caption accuracy raised from measured 0–53% under naive streaming to 81–95% on natural conversation; every production call carries its own measured accuracy score.

### Invention C — In-call synthesized voice for non-speaking users: typed and pictographic speech with conversational-presence cues

**The technical problem:** born-deaf users frequently cannot speak on calls and often cannot type fluently in written Hindi/Gujarati (sign language is their first language); and a caller who hears silence while the user composes a reply abandons the call.

**The method (implemented 2 August 2026, `backend/speech.py`, `backend/call_session.py`, `frontend/src/components/SpeakBoard.tsx`):**

1. A `say` channel on the user's call socket accepts arbitrary text mid-call; the server synthesizes it (per-user chosen voice persona, persistent across calls) and streams it into the telephone call as 16 kHz PCM, recording it on the user's audio track and marking it in the transcript (marked lines are excluded from the caption self-score of Invention B, since they are not caller speech).
2. **TTS language follows the script of the typed text** (Gujarati block → Gujarati voice; Devanagari/Latin → Hindi voice), giving correct pronunciation without a language setting.
3. **A pictographic AAC board** (categorized picture tiles: answers/talk/time/places/needs) speaks complete natural sentences per tile — a no-literacy voice path designed for sign-language-first users. Short phrases are server-cached, making repeated tiles effectively instant.
4. **Conversational-presence cue:** the first keystroke of a typing session automatically plays a synthesized "please wait a moment" into the call — a *telephonic typing indicator* preventing caller abandonment during silent composition.
5. **Microphone-optional call handling:** call acceptance proceeds without microphone permission or hardware, entering a type-to-speak mode — removing a hard barrier for non-speaking users who decline the permission.

**Technical effect:** a complete duplex call for a user who neither hears nor speaks, on an unmodified caller's ordinary phone call, with caller-side conversational continuity maintained.

---

## 6. Section 3(k) positioning (for attorney assessment)

The claims are framed as methods operating on telephony media streams and signalling with measurable technical effects (noise-robust recognition, guaranteed-live audio paths at ring time, per-tenant isolation on shared telephony resources, latency/accuracy trade control, stream-cadence-preserving gating), not as business methods or programs per se. Production measurements (stage-timed call funnels, per-call accuracy scores) are available as evidence of technical effect.

## 7. Known prior art (inventor's honest listing — for attorney search)

- US IP-CTS/CapTel ecosystem (Hamilton, CaptionCall, InnoCaption): human-assisted or ASR captioned telephony; dedicated numbers/devices; US regulatory infrastructure.
- Rogervoice (FR): app-based captioned calls with typed TTS replies; app-centric numbering.
- Google Live Caption / Pixel call captioning; Android Real-Time Text (RTT).
- Generic AAC systems (picture boards → speech) outside telephony.
- Standard carrier call-forwarding (**21*) and cloud-telephony webhook/streaming APIs (Vobiz/Plivo/Twilio-class), as building blocks.

The claimed contributions are the specific combinations and mechanisms of Sections 5A–5C, not captioning, forwarding, TTS or AAC individually.

## 8. Commercial context

Deployed in production (sunosathi.com) with pilot users onboarding; ~₹1.5/min marginal cost; brand "SunoSathi / सुनोसाथी" (trademark filing recommended in parallel); roadmap includes ISL video-relay platform and ISL corpus accumulation.

## 9. Materials available to attorney

- Full git history with dated commits for every mechanism above
- Production monitoring exports: per-call stage timings and accuracy scores
- Architecture: this document; live system demonstration on request

---

*Prepared with technical documentation assistance; all inventive contributions are the inventor's. This document is a technical disclosure, not legal advice.*
