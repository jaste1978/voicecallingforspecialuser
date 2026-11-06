// Approved contributions → the studio dataset, so the app can ship them.
//
//   node contribute/scripts/export-to-studio.mjs --key $ADMIN_KEY
//   node contribute/scripts/export-to-studio.mjs --key … --dry
//
// This is the missing link in a chain that was otherwise complete:
//
//   contribute.sunosathi.com  (SQLite + R2)
//        ↓  this script
//   sign-studio/data/clips/contribute/*.json
//        ↓  node sign-studio/scripts/export-to-app.mjs
//   frontend/public/signs/manifest.json + clips
//        ↓  the frontend build that already happens
//   real ISL in the call screen
//
// It deliberately stops at the studio dataset instead of writing
// frontend/public/signs itself. Picking the best take per phrase — tie-broken
// on two-hand tracking — already lives in export-to-app.mjs, and a second
// implementation of that choice is how two halves of one dataset start
// disagreeing about which take is the good one.
//
// On privacy: whatever ends up in a clip is published to every app user, so
// a clip carries a per-signer pseudonym and nothing else about the person.
// The real identities go to provenance.jsonl, which stays on this machine and
// is what makes a deletion request answerable after an export has shipped.

import { createHash } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '../..')

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

const BASE = arg('url', 'https://contribute.sunosathi.com').replace(/\/$/, '')
const KEY = arg('key', process.env.CONTRIBUTE_ADMIN_KEY ?? '')
const OUT = resolve(arg('out', join(REPO, 'sign-studio/data/clips/contribute')))
const DRY = process.argv.includes('--dry')

if (!KEY) {
  console.error('Need an admin key: --key <ADMIN_KEY>, or set CONTRIBUTE_ADMIN_KEY.')
  process.exit(1)
}

// ---- pull ------------------------------------------------------------------

const url = `${BASE}/api/admin/export.jsonl?review_status=approved&limit=50000`
const res = await fetch(url, { headers: { 'X-Admin-Key': KEY } })
if (!res.ok) {
  console.error(
    res.status === 401
      ? `Rejected by ${BASE} — wrong admin key.`
      : `${BASE} returned ${res.status}.`,
  )
  process.exit(1)
}

const rows = (await res.text())
  .split('\n')
  .filter((line) => line.trim())
  .map((line) => JSON.parse(line))

// A server older than this script answers without these and every clip
// would quietly get a filename of "undefined" and a consent date of 1970.
// Silence is the wrong failure here: this runs against production, by hand,
// and nobody re-reads 300 filenames.
const stale = rows.find((r) => r.id === undefined || r.created_at === undefined)
if (stale) {
  console.error(
    `${BASE} is running an older build — its export has no id/created_at.\n` +
    'Deploy the current backend, then run this again.',
  )
  process.exit(1)
}

if (rows.length === 0) {
  console.error(
    'No approved clips yet. Everything recorded so far is still pending —\n' +
    'either review it, or mark the contributor trusted and re-record.',
  )
  process.exit(1)
}

// ---- map -------------------------------------------------------------------

/** Stable per-signer pseudonym. Groups one person's clips for whoever trains
 *  on them, without putting a database id in front of every app user. */
const pseudonym = (contributorId) =>
  `c-${createHash('sha256').update(contributorId).digest('hex').slice(0, 10)}`

const iso = (seconds) => new Date((seconds ?? 0) * 1000).toISOString()

/**
 * A contribution row → a SignClip, as poseFormat defines it.
 *
 * `quality` is the one real translation. The studio's exporter ships only
 * takes a reviewer called 'good', and this platform's equivalent of that
 * judgement is review_status === 'approved' — reached either by two
 * reviewers agreeing or by the contributor being trusted outright. Which of
 * those it was is kept in `notes`, because the distinction has to survive
 * the trip into the dataset.
 */
function toClip(row) {
  return {
    id: row.id,
    format: row.format,
    phraseId: row.phrase_id,
    text: row.text,
    gloss: row.gloss,
    kind: row.kind,
    signer: {
      signerId: pseudonym(row.contributor_id),
      // Never populated. poseFormat says this is kept local and must not ship
      // in the app bundle — and these files are the app bundle.
      displayName: '',
      consentedAt: iso(row.created_at),
      scope: 'research-and-product',
      note: `consent ${row.consent_id ? 'recorded' : 'missing'}`,
    },
    fps: row.fps,
    durationMs: row.duration_ms,
    frames: row.keypoints,
    notes: [
      `via ${row.approved_via ?? 'peer-review'}`,
      row.variant_tag ? `regional variant: ${row.variant_tag}` : '',
    ].filter(Boolean).join(' · '),
    quality: 'good',
    createdAt: iso(row.created_at),
    ...(row.video_key ? { video: row.video_key } : {}),
  }
}

const clips = rows.map(toClip)

// ---- report ----------------------------------------------------------------

const byPhrase = new Map()
for (const c of clips) byPhrase.set(c.phraseId, (byPhrase.get(c.phraseId) ?? 0) + 1)
const signers = new Set(clips.map((c) => c.signer.signerId))
const variants = clips.filter((c) => c.notes.includes('regional variant'))
const trusted = rows.filter((r) => r.approved_via === 'trusted-contributor')
const bytes = clips.reduce((a, c) => a + JSON.stringify(c).length, 0)

console.log(
  `${clips.length} approved clips · ${byPhrase.size} phrases · ` +
  `${signers.size} signer(s) · ${(bytes / 1024).toFixed(0)}KB`,
)
console.log(
  `  ${trusted.length} trusted-contributor · ${clips.length - trusted.length} peer-reviewed` +
  (variants.length ? ` · ${variants.length} tagged as regional variants` : ''),
)

// A phrase is only as good as its best take, and one take is a single
// person's way of signing it. Worth seeing before this becomes what the app
// shows everybody.
const thin = [...byPhrase.values()].filter((n) => n === 1).length
if (thin) console.log(`  ${thin} phrase(s) have exactly one take`)

if (DRY) {
  for (const [phraseId, n] of [...byPhrase].sort()) {
    const c = clips.find((x) => x.phraseId === phraseId)
    console.log(
      `  ${phraseId.padEnd(22)} ${String(c.gloss).padEnd(20)} ` +
      `${n} take(s)  ${(c.durationMs / 1000).toFixed(1)}s`,
    )
  }
  console.log(`(dry run — nothing written to ${OUT})`)
  process.exit(0)
}

// ---- write -----------------------------------------------------------------

// Full rewrite of this directory only. Other subdirectories of data/clips are
// the studio's own recordings and are none of our business.
await rm(OUT, { recursive: true, force: true })
await mkdir(OUT, { recursive: true })

for (const clip of clips) {
  await writeFile(join(OUT, `${clip.phraseId}.${clip.id}.json`), JSON.stringify(clip))
}

// Stays on this machine: the only way to find which shipped clips belong to
// someone who later asks to be erased.
await writeFile(
  join(OUT, 'provenance.jsonl'),
  rows.map((r) => JSON.stringify({
    contribution_id: r.id,
    contributor_id: r.contributor_id,
    signer_pseudonym: pseudonym(r.contributor_id),
    consent_id: r.consent_id,
    phrase_id: r.phrase_id,
    approved_via: r.approved_via,
    video_key: r.video_key,
  })).join('\n') + '\n',
)

console.log(`→ ${OUT} (${clips.length} clips + provenance.jsonl)`)
console.log('next: node sign-studio/scripts/export-to-app.mjs')
