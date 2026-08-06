# SunoSathi Sign-Language Layer — Technical Spec & Feasibility

_Drafted 6 Aug 2026. Status: SPEC ONLY — no build committed yet._

## 1. What we're building (user story)

For users who cannot hear **and** cannot read comfortably — sign-language-first
users, often deaf from birth:

- **Incoming**: caller speaks → our existing live captions → rendered as
  **Indian Sign Language (ISL)** on the call screen (video clips or animated
  avatar), word by word, with the caption text below.
- **Outgoing**: user signs to the camera → recognized → spoken to the caller
  with the same TTS pipeline as type-to-speak. (Bounded vocabulary; the
  picture board and typing remain as always-available fallbacks.)

This is the "AI interpreter middle layer" from our invention disclosure —
shipping any slice of it is reduction-to-practice that strengthens the filing.

## 2. Honest feasibility summary

| Direction | Bounded version | True version |
|---|---|---|
| Speech → sign (incoming) | **Buildable now**: word-by-word sign playback ("Signed Hindi" word order) | Research: real ISL grammar (word order, spatial grammar, facial grammar) — no production system exists |
| Sign → speech (outgoing) | **Buildable**: closed vocabulary of ~30–60 signs → TTS | Research: continuous free-form signing is unsolved everywhere; ISL is extra low-resource |

Google's SignGemma (on-device sign→text, ~200ms) is **ASL-only** and
one-directional; ISL support "planned, no timeline". Watch it — if ISL lands,
Phase B leaps forward for free.

## 3. Phase A — Sign view for incoming speech

### Pipeline

```
caption text (already streaming)
  → normalize (existing normalize_caption_script → Devanagari)
  → tokenize + stem (Hindi morphology: बोलिए/बोलो/बोल → बोल)
  → sign-asset lookup (word → clip id; synonym map; number/name → fingerspell)
  → playback queue in call screen (sequential clips, ~1.5×, skippable)
```

Caption text stays visible under the sign strip — sign + text + (optional)
audio all reinforce each other.

### Content — the real work

Three options evaluated:

**A1. ISLRTC dictionary clips (RECOMMENDED start)**
- Govt. ISL dictionary: **10,000 sign videos** (3rd edition, 2021) across
  everyday/academic/technical/legal/agricultural categories. Free on
  YouTube/Drive/DIKSHA.
- **License**: per ISLRTC FAQ — usable for "research, teaching and technology
  development" with attribution to ISLRTC/DEPwD/MSJE; **"not to be resold or
  used for any profiteering purposes."**
- ⚠️ ACTION BEFORE BUILD: write to ISLRTC for written permission for use in
  an accessibility product (free tier certainly; clarify if we ever charge).
  They are the Ministry of Social Justice — an accessibility use case is
  exactly their mandate; also opens a partnership door.
- Pipeline work: download, trim intro/outro frames, crop to signer, compress
  to short WebM (~150–300KB each), name by lemma, host on our
  CDN/Railway volume. Top-500 vocabulary ≈ **~100–150MB total** — trivial.

**A2. 3D avatar (HamNoSys/SiGML, e.g. JASigning)**
- Academic tech, dated rendering, robotic motion; deaf users consistently
  rate it poorly vs. human video. Custom rigged avatar with mocap is a
  ₹10L+ content project. NOT recommended for v1.

**A3. Commercial avatar vendors**
- No mature ISL vendor today; research prototypes only (3D avatar papers,
  2025–26). Revisit in a year.

### Vocabulary selection

Start from **our own call transcripts** (we have real conversation data):
frequency-rank the words, cover the top ~300–500 lemmas + the picture-board
sentences + numbers 0–9 + fingerspelling alphabet for names/OOV words.
Expected caption coverage at 500 lemmas: roughly 80–90% of tokens
(Zipf's law; measure on our transcripts before freezing the list).

### UI

- "Sign view" toggle on the call screen (and default in Settings, per-user
  pref via existing user_prefs).
- Sign strip above captions: current sign playing large, queue dots,
  highlighted word in the caption line syncs with the clip playing.
- Speed control (1×/1.5×/2×) — signs must keep up with speech; playback at
  1.5× with skip-stopwords is standard practice in sign captioning research.
- Missed-word handling: unknown word → fingerspell first letters + show text
  emphasized.

### Effort

- Asset pipeline script + 500-clip pass: ~1 week (mostly automated + manual QA).
- Backend: `sign_map` table + `/api/signs/:lemma` static serving: 1–2 days.
- Frontend sign strip + sync + prefs: ~3–4 days.
- ISLRTC permission letter: send day 1 (build can proceed in parallel for
  internal testing; don't ship publicly until answered).
- **Total: ~2 weeks to a shippable, internally-tested Sign view.**

### Costs

Storage ~150MB static (free at our scale). No per-call inference cost —
lookup + playback only. Zero added latency to captions (sign strip renders
after captions arrive; captions unchanged).

## 4. Phase B — Camera sign replies (bounded)

### Pipeline

```
WebView camera (getUserMedia)
  → MediaPipe Hands/Holistic (on-device, WASM/TF.js)
  → landmark sequence (no video leaves the phone — privacy)
  → small classifier (~30–60 classes, TF.js, <5MB)
  → candidate sign shown as chip ("हाँ?") → user taps to confirm
  → existing say pipeline (speech.speak_pcm → playAudio to caller)
```

Confirm-before-speak is mandatory: misrecognition must never speak wrongly
on the user's behalf (same philosophy as the dial-confirm screen).

### Vocabulary (v1: ~30 signs)

yes / no / okay / wait / thank you / hello / goodbye / how are you / I'm fine /
help / doctor / hospital / medicine / home / come / go / today / tomorrow /
money / food / water / mother / father / work / school / happy / sad /
slow(ly) / again / stop — final list co-designed with a deaf user (Jayesh).

### Training data

- INCLUDE dataset (IIT-M): 263 isolated ISL signs, 7 signers — pretrain.
- iSign benchmark (118K ISL video-sentence pairs) — pose backbones.
- Our own collection: ~20 recordings per sign per 3–5 signers (a weekend with
  a deaf community group; doubles as user research + marketing content).

### Risks

- WebView camera + WASM perf on low-end Android — must test on ₹8–10k phones.
- Lighting/background variation — landmarks (not pixels) mitigate.
- Signer variation (regional ISL variants) — the confirm-chip absorbs errors.
- **Effort: ~3–4 weeks including data collection. Demo-able at 10 signs in ~1 week.**

## 5. Phase C — true two-way ISL (research/partnership track)

- Partner candidates: AI4Bharat (IIT-M, iSign authors), ISLRTC (govt mandate,
  training programs, signer access).
- Watch: SignGemma ISL support; iSign Text2Pose models for avatar generation.
- Not a solo build. Revisit quarterly.

## 6. Licensing summary

| Asset | Terms | Action |
|---|---|---|
| ISLRTC dictionary videos | Attribution required; no resale/profiteering | Written permission letter before public ship |
| INCLUDE / iSign datasets | Research licenses (check per-dataset on use) | Verify at Phase B start |
| MediaPipe / TF.js | Apache 2.0 | None |
| SignGemma | Limited preview, Google terms | Watch for ISL + open weights |

## 7. Recommended build order

1. **Now**: send ISLRTC permission request; run vocabulary-coverage analysis
   on our transcripts (1 script, half a day) to validate the 500-lemma claim.
2. **Phase A build** (~2 weeks) → internal test with Jayesh → ship behind a
   per-user "Sign view" preference.
3. **Phase B** after A ships (~3–4 weeks), starting with the 10-sign demo.
4. Update invention disclosure with implemented claims after each phase.
