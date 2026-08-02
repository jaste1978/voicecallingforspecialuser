# SunoSathi (सुनोसाथी) — Feature List

**Your phone number. Their voice, your eyes.**
A real phone line for deaf, hard-of-hearing and non-speaking Indians: callers dial normally, the user reads live captions and answers with voice, typed text or picture tiles.

*Built 26 July – 2 August 2026 · in production at [sunosathi.com](https://sunosathi.com) · powered by Sarvam AI · v0.20.1*

---

## 1. Calls on your own number

- **Keep your number** — forward your existing SIM number to SunoSathi with one dial code (`**21*…#`); family and services call you exactly as before. No new SIM, no porting, no caller-side change.
- **Incoming calls** ring in the app with the caller's name or number; accept/decline like a normal phone.
- **Outgoing calls** to any number, from contacts or a dial pad — fully captioned both ways.
- **Reliability engineering**: the app never rings unless the audio path is confirmed live ("ring-on-stream"); ended calls can't ghost-ring again; rapid-redial network flakes are detected and reported instead of failing silently.
- **Sub-second ring delivery** — measured 0.5 s from carrier dial to ring on screen in production.

## 2. Live captions (the ears)

- **Streaming speech-to-text** over the call with **automatic language detection** — Hindi, Gujarati, English and mixed "Hinglish" in one conversation, no setting to choose.
- **Accuracy-first captioning**: phrases are finalized at natural pauses instead of streaming half-guessed words — measured 81–95% accuracy on natural conversation, ~150 ms behind speech end.
- **Adaptive noise gate**: street/TV/kitchen noise is learned per call and silenced before it reaches the recognizer — no more hallucinated "junk words" from background sound; speech over noise still captions.
- **Romanized rescue**: if speech can't be identified for 8 seconds, captions switch to writing the sounds phonetically so the user is never left with a blank screen.
- **Readable-script guarantee**: captions always render in Devanagari/Gujarati/English — stray auto-detected scripts (Odia, Bengali, Kannada…) are converted to readable script, live and in history.
- **Reading comfort**: adjustable caption size (A− / A+, remembered), chat-bubble layout with timestamps, "caller is speaking…" indicator, warm high-legibility theme.

## 3. A voice for non-speaking users (the mouth)

- **Type-to-speak**: type anything mid-call; the caller hears it ~1 second later in a natural Indian voice. Typed lines appear in the chat marked 🔊.
- **Quick reply chips**: one-tap हाँ · ना · ठीक है · रुकिए · दोबारा · बाद में.
- **🖼️ Picture-talk board**: 30 picture tiles across Answers / Talk / Time / Places / Needs that speak complete sentences — built for sign-language-first users who don't type. No literacy needed.
- **Telephonic typing indicator**: the first keystroke automatically tells the caller *"कृपया एक क्षण रुकिए"* so they don't hang up during silent typing.
- **My voice**: each user picks the voice callers hear (7 male/female options), consistent across calls.
- **Script-smart speech**: type in Gujarati script → Gujarati voice; Devanagari/English → Hindi voice. Automatic.
- **Mic optional**: calls can be answered and made with microphone permission denied or absent — the call simply runs in type-to-speak mode.
- **Speaker toggle**: caller audio on/off per device — sound + captions for hard-of-hearing users, silence for deaf users, audio for a family member nearby.

## 4. Accessibility alerts (the doorbell)

- **Background ringing (Android app)**: a persistent "call watch" service rings the phone — full repeating vibration + high-priority lock-screen notification — even with the app closed and screen off.
- **Haptic language** (in the mobile shell): distinct vibrations for ring, call connected, caller started speaking, new caption, call ended.
- **Ring & vibration settings** with visual ringtone options and per-alert haptic toggles.

## 5. A multi-user platform

- **Per-user lines**: each user's calls ring only their devices; different users can be on calls simultaneously on shared infrastructure.
- **Private data**: call history, transcripts, recordings and contacts are isolated per account; recordings gated by ownership.
- **Users & Numbers admin screen**: create a pilot user, generate a password, link their forwarded number, and copy a ready-to-WhatsApp setup message — onboarding in under a minute.
- **Accounts & security**: email+password login (scrypt), 30-day sessions, admin role separation.

## 6. History & contacts

- **Call history** with names, direction/missed color coding, relative times, durations; tap to expand the full caption transcript.
- **Call recordings**: both sides (caller / user) playable per call.
- **Contacts**: add, call, delete; caller-name resolution on ring, in-call and in history.

## 7. Quality that measures itself

- **Automatic accuracy score on every call**: the recording is re-transcribed by a full-context model and compared to the live captions (script-blind, transliteration-tolerant) — each call carries its own accuracy %.
- **Call Monitor (admin)**: live connection status and a per-call stage funnel — received → media → ring sent → ring shown → answered → captions — with millisecond timings, pass/fail against targets, and a plain-language failure reason for every unsuccessful call.
- **Full call timeline**: every data-pipeline event (audio frames, captions, latencies, gate activity, TTS plays) recorded per call for debugging.
- **AI model flexibility (admin)**: swappable STT/TTS providers with bring-your-own-key (Sarvam, Deepgram, Google STT, ElevenLabs); language-capability routing with automatic fallback.

## 8. Apps & reach

- **Web app / PWA** at app.sunosathi.com — installable, works on any modern browser.
- **Android app (APK)** — standalone, with background ringing and haptics; auto-updates its content from the web.
- **iPhone testing** via Expo Go QR at sunosathi.com/ios (TestFlight planned).
- **Welcome experience**: the app demos itself before login — a captioned call animating word-by-word in Hindi and Gujarati — with in-app pilot signup.
- **First-run guidance**: one-time forwarding setup card with the dial code; disappears after the first successful call.

## 9. Marketing & operations

- **sunosathi.com**: hand-crafted marketing site — animated Hindi/Gujarati/Hinglish conversation hero, real photography, warm "western orange" brand — with SEO (JSON-LD, sitemap, llms.txt) and a pilot waitlist feeding the admin panel.
- **Single-service deploy** on Railway with persistent storage, health/version endpoint, and verified-deploy workflow.
- **Cost profile**: ~₹1.5/min all-in per captioned call, with a documented cost-reduction ladder.

---

### The one-line stack

Vobiz cloud telephony (DID + bidirectional 16 kHz media streams) → FastAPI backend (per-user call lines, noise gate, quality loop) → Sarvam saaras v3 streaming STT + Bulbul TTS → React PWA + Expo Android shell.

### What's next (roadmap highlights)

Personal phrase books · LLM smart replies · simple-language captions · ISL interpreter video-relay partnership · TestFlight iOS · sign-recognition quick phrases · trademark & provisional patent filings.
