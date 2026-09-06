# ISL contribution platform — Track C

Common Voice, for Indian Sign Language. A public place where deaf signers,
interpreters and NGO members record short ISL clips phrase by phrase, so
Track B's text→pose model has real data to learn from.

Deployed as its own Railway service at **contribute.sunosathi.com**. Shares
the repo with the main app and nothing else — separate database, separate
process, separate deploy, so the three parallel tracks never block each
other.

Plan and rationale: [`docs/CONTRIBUTE-PLATFORM.md`](../docs/CONTRIBUTE-PLATFORM.md).

---

## Status

Done:

- **Accounts with admin approval.** Anyone can register; nobody records until
  an admin approves them. Sessions are httpOnly cookies over scrypt-hashed
  passwords — no auth library, no token in localStorage. Suspending an
  account revokes its live sessions immediately.
- Landing → register → *approval* → consent → record loop, mobile-first,
  Hindi + English throughout.
- Consent stored per contribution, versioned, with a hash of the exact
  wording that was on screen. `contributions.consent_id` is `NOT NULL` and
  the API refuses any clip whose consent it cannot find.
- MediaPipe Holistic in the browser during recording; keypoints to SQLite,
  video straight to R2 with a presigned PUT.
- Phrase queue ordered by what the dataset still needs.
- Admin stats and the JSONL export Track B consumes.

Not yet (M2+): review queue, contributor profiles page, Telegram digest,
credit wall, deletion-request handling in the UI.

### A note on the gate

The original brief specified *zero login friction* for contributors, and this
is deliberately the opposite. For a pilot of a handful of NGO signers that is
the right trade: no spam, no clips from someone who never read the consent
screen, and a real name against every recording. It stops being right at
scale, so it is a setting rather than a design — `ACCESS_MODE=open` makes
registration self-approving and the waiting room disappears, with no code
change.

**Consent wording is a DRAFT** (`backend/consent.py`, version `v1-draft`).
Tejas has final say before this goes in front of NGO partners. Changing it
means bumping `VERSION` — old records keep saying what old contributors
actually agreed to.

---

## Running it

Two processes. The frontend dev server proxies `/api` to the backend.

```bash
# API on :8100
python3 -m uvicorn main:app --app-dir contribute/backend --port 8100 --reload

# web on :5190  (first run downloads the ~14MB Holistic model)
npm install --prefix contribute/frontend
npm run dev --prefix contribute/frontend
```

Or, from Claude Code / the launch config: the `contribute-api` and
`contribute` entries in `.claude/launch.json`.

### Testing on a real phone — read this first

Browsers only hand out the camera on **HTTPS or localhost**. Opening
`http://192.168.x.x:5190` on a phone will show the page and then fail to
start the camera, which looks like a bug and is not one.

Put a real certificate in front of it with a tunnel:

```bash
cloudflared tunnel --url http://localhost:5190
```

That prints an `https://<random>.trycloudflare.com` URL. Open **that** on the
phone. The vite proxy keeps `/api` pointed at the backend, so nothing else
changes.

---

## Cloudflare R2 (video storage)

Until this is configured the loop still works: keypoints — the actual
training data — are stored, and contributions are marked
`video_status = 'skipped'`. Nothing breaks and nothing is lost except the
raw footage. So the pilot can start before the bucket exists.

**Creating the bucket** (Tejas, in the Cloudflare dashboard):

1. R2 → *Create bucket* → name `isl-contributions`, location Automatic.
2. R2 → *Manage API tokens* → *Create API token* → **Object Read & Write**,
   scoped to that one bucket. Copy the Access Key ID and Secret — the secret
   is shown once.
3. Note the Account ID from the R2 overview page.
4. Bucket → Settings → **CORS policy**. The browser uploads directly, so
   without this every PUT fails:

```json
[
  {
    "AllowedOrigins": ["https://contribute.sunosathi.com"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["content-type"],
    "MaxAgeSeconds": 3600
  }
]
```

Add the tunnel origin to `AllowedOrigins` while testing from a phone, and
take it out afterwards.

The bucket stays **private**. Clips are read back through short-lived
presigned GET URLs, never public links — these are videos of people's faces.

---

## Environment

| Variable | What happens without it |
|---|---|
| `CONTRIBUTE_DB` | Database sits next to the code instead of on the Railway volume. Set it to `/data/contribute.db` in production. |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | Videos are skipped; keypoints still stored. |
| `R2_BUCKET` | Defaults to `isl-contributions`. |
| `TURNSTILE_SECRET` | Turnstile check is a no-op. Share the value from the main service. |
| `VITE_TURNSTILE_SITEKEY` | Build-time. Widget is not rendered. Use `0x4AAAAAAEqa3x_MLNDKWW_D` (covers `*.sunosathi.com`) — leave it unset for local and tunnel testing, where a sitekey scoped to that domain cannot validate. |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | **No admin account exists**, so nobody can approve anyone. Set both; the account is created on boot. |
| `ADMIN_NAME` | Admin shows up as "Admin". |
| `ADMIN_PASSWORD_RESET` | Set to any value to force `ADMIN_PASSWORD` onto an existing admin account, then remove it. Without it a redeploy never overwrites a password you changed later. |
| `ACCESS_MODE` | Defaults to `approval` — new accounts wait for an admin. `open` auto-approves. |
| `ADMIN_KEY` | Header-key access to the admin API is off. Browser admin login still works; this is only for scripted export. |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Registration alerts are logged instead of sent. |

---

## Roles and access

| Role | Can |
|---|---|
| `contributor` | Record clips once approved. |
| `reviewer` | Contributor, plus the review queue (M2). Approve someone as a reviewer in one click from the admin screen. |
| `admin` | Everything, plus `/admin` — the approval queue, and suspend/re-approve. |

Sign in at `/`, and the admin screen is at `/admin`. A registration sends a
Telegram alert immediately rather than waiting for a digest — someone
standing in an NGO office waiting to be let in is the one case where a daily
summary is too slow.

## The phrase list

Generated from Track B's recording list — never hand-edited:

```bash
node contribute/scripts/sync-phrases.mjs
```

`sign-studio/src/lib/phrases.ts` is where a phrase's Hindi, its gloss and the
facial grammar the signer must hold are authored. Track B trains on that
gloss, so a second hand-maintained copy here would drift silently and
contributors would end up recording the wrong facial grammar for phrases
Track B had since reclassified. The generated
`backend/phrases_seed.json` is committed and upserted on every boot; `active`
and `target_count` are left alone once a row exists, since those are the
admin's to tune.

124 phrases today: 73 tier-1 words from the picture-card vocabulary, 40
whole call sentences, 11 numbers.

---

## Borrowed code

`frontend/src/vendor/` holds generated copies of two files this service does
not own: the pose format (`frontend/src/lib/sign/poseFormat.ts`) and Track
B's landmark extraction (`sign-studio/src/lib/holistic.ts`). They are copies
because this service deploys on its own, from committed code, and both
originals still live in another track's uncommitted working tree.

They must stay byte-identical to their originals — a clip recorded on a
contributor's phone and one recorded in the studio land in the same training
set. `npm run sync` refreshes them; the build runs `--check` and fails on
drift rather than shipping a quiet divergence. When Track B commits its
folder, this can go back to a plain alias.

```bash
npm run sync --prefix contribute/frontend   # refresh vendor + phrase seed
```

## Handover to Track B

```bash
curl -H "X-Admin-Key: $ADMIN_KEY" \
  "https://contribute.sunosathi.com/api/admin/export.jsonl?review_status=approved" \
  > isl-clips.jsonl
```

One JSON object per line, the format agreed in the brief:

```json
{"phrase_id":"ps-coming-tomorrow-q","gloss":"TOMORROW YOU COME",
 "text":{"hi":"कल आ रहे हो?","en":"Are you coming tomorrow?"},
 "contributor_id":"c_…","consent_id":"k_…","review_status":"approved",
 "variant_tag":"","format":2,"fps":25,"duration_ms":3560,
 "coverage":{"body":1.0,"face":0.94,"handL":0.88,"handR":0.81},
 "video_key":"clips/ps-coming-tomorrow-q/2026/09/06/s_….webm",
 "keypoints":[{"t":0,"body":[…],"handL":[…],"handR":[…],"face":[…],"g":{…},"anchor":{…}}]}
```

`keypoints` are `SignFrame`s in canonical signing space, format version 2 —
the same objects the studio writes and the app's renderer draws. Drop
`?review_status=approved` to see everything including unreviewed clips.

## Deploying

Own Railway service in the `sunosathi` project, built from
`contribute/Dockerfile` with the repo root as context. Deploy committed code
only — three chats share this working tree:

```bash
./scripts/deploy.sh
```

It needs a volume mounted at `/data` (for `CONTRIBUTE_DB`) and the variables
above.
