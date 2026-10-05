# SunoSathi content pipeline & admin Content screen — developer handoff

_Written 2026-09-24. Hand this to a fresh session; it assumes no prior context._

---

## 0. Read this first

**Nothing in here is committed.** Every change described below sits in the
working tree awaiting review by **Tejas Langalia**, who is the named reviewer
for all tasks on this project. The rule for any agent or dev working here:

> You may write files, run tests, push a branch and open a PR.
> You may **not** merge, deploy, publish, or `git push` to `main`.

**The working tree routinely has unrelated in-progress work.** Never run
`git add -A`. Stage explicit paths only.

---

## 1. What this project is

**SunoSathi** (सुनोसाथी) turns a deaf or hard-of-hearing person's **own mobile
number** into a captioned phone. The user dials one carrier forwarding code
(`**21*<number>#`) once; calls to their existing number then ring inside the
SunoSathi app, where they read live captions and reply by voice, by typing
(spoken to the caller), or by tapping picture tiles.

**The caller changes nothing.** No app, no link. That asymmetry is the product
thesis — protect it in every piece of copy and UI.

### Repo

- Path: `~/sunosathi` → symlink → `/Volumes/TL Mac/SARVAM VOICE AGENT`
  **This is an external volume.** If it is not mounted, stop and say so — do
  not improvise a different path.
- Remote: `github.com/jaste1978/voicecallingforspecialuser`, base branch `main`
- Backend: FastAPI, `backend/main.py`
- Frontend: React + TypeScript + Vite, `frontend/`
- Deploy: Railway, single service (`server: railway-hikari`)

### One service, two hosts

`backend/main.py` ends with a catch-all `@app.get("/{path:path}")` that
host-switches:

| Host | Serves |
|---|---|
| `sunosathi.com`, `www.sunosathi.com` | marketing site — static HTML from `frontend/public/` |
| `app.sunosathi.com`, the Railway URL | the React SPA |

Marketing pages are plain files in `frontend/public/` (`welcome.html`,
`guide.html`, `ios.html`, `privacy.html`, `blog.html`, `404.html`, `llms.txt`,
`sitemap.xml`, `robots.txt`). Vite copies `public/` into `dist/` on build; the
backend serves from `dist/`.

**There is no CMS.** Publishing a blog post means committing an HTML file.

---

## 2. What changed in this round

### 2a. The soft-404 fix — the important one

**Before:** the catch-all returned `index.html` for *every* unmatched path, with
HTTP **200**. Correct for the SPA host (deep links must survive a reload), wrong
for the marketing host. `https://sunosathi.com/definitely-not-a-real-page`
returned 200. Search engines indexed typos as duplicate homepages, and no tool —
including a link checker — could verify a page by status code.

**After:** `main.py` gained `MARKETING_HOSTS` and a `SPA_ROUTES` allowlist. On
the marketing host, an unknown path returns `404.html` with status **404**. The
app host keeps its SPA fallback unchanged.

> ⚠️ **`SPA_ROUTES` in `backend/main.py` mirrors the routes in
> `frontend/src/App.tsx` by hand.** Add a route to the app and forget to add it
> there, and it will 404 on `sunosathi.com`. There is **no automated check** —
> it was offered and declined. If a route mysteriously 404s, look here first.

Verified with 18 routing assertions (marketing + app host, blog routes, SPA
routes preserved, path traversal blocked).

### 2b. Blog

New: `/blog` index and `/blog/<slug>` posts, served from
`frontend/public/blog.html` and `frontend/public/blog/<slug>.html`, images under
`frontend/public/img/blog/`.

`blog.html` contains `<!-- POSTS:START -->` / `<!-- POSTS:END -->` markers.
**Keep them** — the publish script inserts new cards after `POSTS:START`
(newest first).

First post: *How Deaf and Hard-of-Hearing People Can Make Phone Calls in India
(2026)* — 1,978 words, 9-question FAQ, `Article` + `FAQPage` + `BreadcrumbList`
JSON-LD.

### 2c. `llms.txt` corrected

It claimed iPhone ran via **Expo Go**; the App Store build is live. Since
`robots.txt` explicitly welcomes GPTBot / ClaudeBot / PerplexityBot /
Google-Extended / CCBot, that file was actively misinforming the crawlers it
invited. Fixed, and `/blog` added.

### 2d. Sitemap

Previously listed only `/` and `/guide`. `/ios` and `/privacy` existed but were
missing. Now 6 URLs.

### 2e. Admin → Content & SEO screen

New read-only admin screen at **`/content`**, reachable from Settings → Admin →
"Content & SEO".

- `frontend/src/pages/ContentPage.tsx` — three tabs: **Posts**, **Calendar**, **Health**
- `GET /api/content` in `backend/main.py`, gated by `_require_admin`
- Data source: `backend/content_status.json`, a **committed** file

**Why a committed file?** The content pipeline lives in a separate project
(`~/SEO AUTOMATION`) that is not deployed to Railway, so the backend cannot read
it at runtime. The pipeline flattens its state into JSON and commits it.

The endpoint **re-derives** each post's `published`/`draft` state from what is
actually in `dist/blog/` rather than trusting the file — a post is never
reported live unless its HTML really shipped.

---

## 3. Files changed — and whose changes they are

**⚠️ `App.tsx` and `icons.tsx` already had Tejas's uncommitted work before these
edits.** Those files now contain a mix. Review hunk by hunk.

### Mine, entirely new
```
backend/content_status.json              generated; do not hand-edit
frontend/public/404.html
frontend/public/blog.html
frontend/public/blog/how-deaf-people-can-make-phone-calls-in-india.html
frontend/public/img/blog/*.png           (3 files)
frontend/src/pages/ContentPage.tsx
docs/CONTENT-PIPELINE.md                 this file
```

### Mine, edits to existing files
```
backend/main.py                 _dist_dir(), /api/content, MARKETING_HOSTS,
                                SPA_ROUTES, blog routes, real 404
frontend/public/llms.txt        Expo Go line fixed, /blog added
frontend/public/sitemap.xml     +/ios +/privacy +/blog +the post
frontend/src/index.css          appended "Content & SEO (admin)" block at EOF
frontend/src/pages/AdminPage.tsx  one admin Row + DocIcon import
```

### Mixed — mine plus pre-existing WIP
```
frontend/src/App.tsx            mine: ContentPage import, '/content' in TITLES,
                                SETTINGS_CHILDREN and <Route>
frontend/src/components/icons.tsx  mine: DocIcon appended at EOF
```

### Untouched by me (pre-existing WIP, ignore when reviewing this work)
`pictureCaptions.ts`, `CallPage.tsx`, `ContactsPage.tsx`, `HelpPage.tsx`,
`StartPage.tsx`, `SupportPage.tsx`, `CallFeedback.tsx`, `SignFigure.tsx`,
`SignStrip.tsx`, `UpdateGate.tsx`, `presence.ts`, `shell-update.ts`, `lib/sign/`

---

## 4. The companion project — `~/SEO AUTOMATION`

Separate directory, not a git repo, **not deployed**. It produces content;
this repo serves it.

```
brand/sunosathi/       brand-profile.md, internal-links.md
plan/                  sunosathi-content-calendar.md   (8 ranked topics, 5 tripwires)
                       sunosathi-automation.md         (the runbook — read this)
outputs/<slug>/        research/ content/ images/ publish/  per post
scripts/render_post.py            article.md -> standalone post.html
scripts/publish_to_sunosathi.py   installs a post into THIS repo, optional PR
scripts/build_content_status.py   regenerates backend/content_status.json
```

> `outputs/` is shared with another client (Augmont). `build_content_status.py`
> filters on `meta.canonical` containing `sunosathi.com` — keep that filter.

### Publishing a post

```bash
cd ~/"SEO AUTOMATION"
python3 scripts/render_post.py --topic-dir outputs/<slug>
python3 scripts/publish_to_sunosathi.py --topic-dir outputs/<slug>              # dry run
python3 scripts/publish_to_sunosathi.py --topic-dir outputs/<slug> --apply      # write
python3 scripts/publish_to_sunosathi.py --topic-dir outputs/<slug> --apply --pr # + PR
```

`publish_to_sunosathi.py` **refuses** to install a post with a missing
`content/` or `images/` file, `meta_title` > 60 chars, `meta_description`
outside 150–160, an image referenced but absent, a manifest entry lacking alt
text, or **an internal link to a page that does not exist**. All six refusals
were verified. **Do not bypass a refusal, and do not edit the script to make a
check pass** — fix the post.

### Scheduled tasks

Two exist (`~/.claude/scheduled-tasks/`):

- `sunosathi-weekly-post` — Tuesdays 9am: next calendar topic → research →
  write → images → **PR**
- `sunosathi-monthly-freshness` — 1st of month 10am: tripwire check + AI
  citation baseline → **report only**

Both are instructed not to merge, deploy, or fabricate a stage that did not run.

---

## 5. Running it locally

### Backend
```bash
cd "/Volumes/TL Mac/SARVAM VOICE AGENT/backend"
python3 main.py          # PORT env, default 8000; needs provider API keys
```

### Frontend
```bash
cd "/Volumes/TL Mac/SARVAM VOICE AGENT/frontend"
npm run build            # tsc -b && vite build
npm run dev              # vite; proxies /api and /ws to localhost:8000
                         # SUNO_BACKEND=localhost:8010 to point elsewhere
npx oxlint               # lint
```

### Previewing `/content` without API keys

The Content screen only needs `GET /api/content`. Run a stub on a spare port,
point Vite at it, and seed an admin token in the browser:

```js
localStorage.setItem('authToken', 'preview-token')
localStorage.setItem('authRole', 'admin')
// then visit /content
```

`SUNO_BACKEND=localhost:8099 npx vite --port 5199` with a stub that returns
`backend/content_status.json` from `/api/content` is enough. Verified working.

---

## 6. Known gaps and open work

| # | Item | Notes |
|---|---|---|
| 1 | **`SPA_ROUTES` drift** | Hand-mirrored from `App.tsx`. A ~10-line test would catch it; offered and declined. Highest-risk item here. |
| 2 | **No keyword-volume data** | No paid keyword tool connected. Calendar priorities are reasoned from SERP composition, **not measured**. Do not present them as measured. |
| 3 | **No AI-engine connector** | GEO citation baseline must be run by hand — six prompts in `plan/sunosathi-automation.md`. **Never fabricate what an engine "would" say**; a made-up baseline is worse than none because next month is compared against it. |
| 4 | **Zero third-party mentions of SunoSathi** | Outreach work (NGOs, press), not writing work. |
| 5 | **Blog images are light-background PNGs** | They sit as light cards on the dark-mode blog page. Acceptable; dark variants would mean re-rendering from `images/generate_images.py`. |
| 6 | **`contribute.sunosathi.com`** | Separate host, no sitemap of its own. |
| 7 | **Post not live** | Files are in the repo; live only after review, merge and a Railway rebuild. |

---

## 7. House rules for content

Pulled from `brand/sunosathi/brand-profile.md`. These are not style preferences —
breaking them costs the brand credibility with the deaf community:

- **Never imply the caller installs or changes anything.**
- **Pilot framing is mandatory** — free *during the pilot*. Not "launched".
- **Four languages today**: Hindi, Gujarati, English, Hinglish. Everything else
  is "coming soon".
- **Caption accuracy is a range, 81–95%.** Never round to a flattering single
  number.
- **Disability language**: "deaf and hard-of-hearing", "non-speaking",
  "sign-language-first". Never "hearing impaired", never "the deaf" as a noun.
- **Never claim the product replaces Indian Sign Language or interpreters.**
  It does not, and saying so costs the NGO relationships.
- Be honest where competitors win — ISLRTC VRS for nuanced ISL, Android Live
  Caption for English-only users.

### Verifying a live page

Until the 404 fix is merged and deployed, `sunosathi.com` still returns 200 for
everything. **Verify by title, not status code:**

```bash
curl -sS https://sunosathi.com/blog/<slug> | grep -o '<title>[^<]*</title>'
```

If the homepage title comes back, the route did not register.

---

## 8. Charts and images

Data graphics are rendered **deterministically with matplotlib**, never an image
model — an image model garbles numbers and text. See
`outputs/<slug>/images/generate_images.py` and `PALETTE-NOTE.md`.

Two hard-won rules:

1. **Validate the palette, don't eyeball it.** The brand's own
   `--danger #D93843` was **rejected**: ΔE 8.4 against `--accent #E4590A` in
   *normal* vision, below the floor of 15. Re-stepped to `#C92A2A` / `#1B7F5A`.
   Status is encoded three ways — glyph, word, colour — never colour alone.
2. **No Devanagari inside images.** matplotlib's DejaVu Sans has no Devanagari
   glyphs and renders tofu boxes. Hindi belongs in the article body.

Always open each rendered PNG and look at it. Three layout defects — a table
overflowing the canvas, a heading colliding with a column, a hero number
overlapping its label — were caught only by looking.
