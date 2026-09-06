// Regenerate the platform's phrase seed from Track B's recording list.
//
//   node contribute/scripts/sync-phrases.mjs
//
// `sign-studio/src/lib/phrases.ts` is the one place a phrase — its Hindi,
// its gloss, and the facial grammar the signer must hold — is authored.
// Track B trains on the gloss, so if the public platform kept its own copy
// the two lists would drift and the drift would be invisible: contributors
// would record "brows raised" takes for a phrase Track B has since decided
// is a wh-question. Hence a generated seed, committed, never hand-edited.

import { register } from 'node:module'
import { writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '../..')

register(pathToFileURL(resolve(HERE, 'alias-hook.mjs')))

const src = resolve(REPO, 'sign-studio/src/lib/phrases.ts')
const { PHRASE_LIST } = await import(pathToFileURL(src).href)

// How many accepted clips we want per phrase before it stops being offered.
// Signing varies by region and by signer; one take is an anecdote, five are
// a distribution. Tier 1 words are the ones the app shows most, so they get
// the deeper stack.
const TARGET = { 1: 6, 2: 4, 3: 4 }

const rows = PHRASE_LIST.map((p, i) => ({
  id: p.id,
  hi: p.hi,
  gu: p.gu ?? '',
  en: p.en,
  gloss: p.gloss,
  kind: p.kind,
  tier: p.tier,
  face: p.face ?? '',
  note: p.note ?? '',
  target_count: TARGET[p.tier] ?? 4,
  sort: i,
}))

const out = resolve(REPO, 'contribute/backend/phrases_seed.json')
await writeFile(out, JSON.stringify(rows, null, 2) + '\n')
console.log(`✓ ${rows.length} phrases → contribute/backend/phrases_seed.json`)
