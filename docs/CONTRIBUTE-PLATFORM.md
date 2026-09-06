# ISL Contribution Platform — Track C brief

_Created 7 Sep 2026 · Owner: Tejas · Built in its own parallel chat._
_Sister docs: PHASE-3.md (why + Track A/B), pictureCaptions.ts (phrase seed)._

## What it is

**Common Voice, for Indian Sign Language.** A public web platform at
**contribute.sunosathi.com** where anyone — deaf signers, interpreters,
NGO members — records short sign videos phrase-by-phrase. Every approved
contribution becomes training data (pose keypoints + video) for
SunoSathi's sign-generation AI (Track B). Tejas is pitching NGOs; the
platform must feel like the community building its own asset, not
donating data to a company.

## The three flows

**Contributor** (mobile-first, zero login friction):
1. Landing: what this is, who it helps, in Hindi + English (Gujarati
   later). Big "Start contributing" button.
2. Consent screen (REQUIRED, bilingual, plain words): my recordings and
   the movement data from them will be used to train SunoSathi's sign
   language AI and may be included in an ISL dataset; I can request
   deletion; opt-in checkbox for name on the credit wall. Stored with
   every contribution (timestamp + consent version).
3. Record loop: show a phrase (e.g. "कल आना" + English gloss) → camera
   preview → 3-5s recording → instant replay → [Submit] [Redo] [Skip].
   MediaPipe Holistic (hands + face + body) runs IN THE BROWSER during
   recording; we upload BOTH the keypoint sequence (small JSON) and the
   video (for later re-extraction with better models).
4. After each submit: progress + gentle streak ("5 signs contributed 🙏").
   Contributor identified by a lightweight profile (name optional, phone
   or email optional for credit/deletion requests) + device id.

**Reviewer** (fluent signers, NGO partners; simple login):
- Queue of unreviewed clips per phrase: play → Approve / Reject (reason:
  wrong sign / unclear / face not visible) / Flag regional variant
  (variant is VALID data, tagged not rejected).
- 2 approvals = accepted into dataset.

**Admin** (Tejas): phrase list management (seeded from Track A's
`frontend/src/lib/pictureCaptions.ts` concepts + transcript top-300),
contributor/reviewer management, dataset export (JSONL of
phrase → keypoints sequences + consent records), stats.

## Tech decisions

- **Same repo, own folder `contribute/`** (backend + frontend), deployed
  as a SEPARATE Railway service → contribute.sunosathi.com (CNAME in
  Cloudflare; launch-track chat can add it, or Track C does). Keeps git
  shared but deploys independent — three chats never block each other.
- Stack mirrors the main app so any chat can work on it: FastAPI +
  SQLite (own Railway volume) + vanilla/React front.
- **Video storage: Cloudflare R2** (Tejas's account already has R2 in
  use — bucket like `isl-contributions`). Keypoint JSON in SQLite/volume.
  Videos never go on the Railway volume (4.9 GB cap).
- **MediaPipe Holistic via @mediapipe/tasks-vision** in-browser; store
  landmarks per frame (hands 2×21, face 478→subset, pose 33) at ~25fps.
  Face landmarks are REQUIRED (facial grammar carries meaning in ISL).
- **Turnstile** on contribution submits (widget "SunoSathi forms" —
  sitekey 0x4AAAAAAEqa3x_MLNDKWW_D covers *.sunosathi.com; secret is in
  Railway env of the main service, share via Track C service env).
- Telegram alerts (existing bot) on new contributions/reviews daily
  digest, not per-clip.

## Reference dictionaries (decision 7 Sep 2026)

- **indiansignlanguage.org** (community ISL video dictionary) and
  **islrtc.nic.in** (official ISLRTC dictionary) are the approved
  REFERENCE sources: in the record flow, a "see reference · सही sign
  देखिए" link opens the dictionary page for the current word so unsure
  contributors can check the standard sign; reviewers use the same links
  to verify correctness.
- **LINK ONLY — never scrape, embed, or download their videos** into our
  app or dataset. Their clips are copyrighted; our dataset must stay
  consent-clean (our own recordings only). Drawing our own 2D artwork of
  a standard sign is fine (a sign is language, not copyrightable).
- Their gap is our value: they hold isolated citation-form signs; nobody
  has conversational phone-domain signing from diverse signers — that is
  what this platform collects.

## Non-negotiables

1. Consent stored per contribution, versioned. Deletion honored.
2. Review before dataset inclusion; regional variants tagged, kept.
3. Contributor credit wall (opt-in) — community ownership feeling.
4. Dataset export format designed WITH Track B (they consume it):
   {phrase_id, gloss, contributor_id, keypoints[], fps, consent_id,
   review_status, variant_tag}.

## Milestones

1. **M1 (week 1)**: record loop working end-to-end on a phone — phrase →
   camera → MediaPipe keypoints → upload video to R2 + keypoints to DB.
2. **M2**: consent + contributor profile + review queue + Telegram digest.
3. **M3**: deploy to contribute.sunosathi.com, pilot with Tejas + 2 NGO
   signers, first 100 clips.
4. **M4**: credit wall, dataset export for Track B, phrase list grows to
   300.

## What Tejas provides

- NGO conversation → first reviewers + contributors.
- R2 bucket creation approval (Track C chat will walk through it).
- Final say on consent wording.
