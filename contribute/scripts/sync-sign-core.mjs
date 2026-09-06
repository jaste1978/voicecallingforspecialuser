// Copy the two files this service borrows into src/vendor/.
//
//   node contribute/scripts/sync-sign-core.mjs           refresh
//   node contribute/scripts/sync-sign-core.mjs --check   fail if stale
//
// Why copies exist at all: this service deploys on its own, from `git
// archive HEAD`, and both sources live in folders other tracks own and have
// not committed yet. A build that depends on someone else's uncommitted
// working tree is not a build.
//
// Why they are generated and never hand-edited: the extraction maths and the
// pose format must be byte-identical to Track B's, because a clip recorded
// on a contributor's phone and one recorded in the studio end up in the same
// training set. `--check` runs in the build, so a drifted copy fails loudly
// instead of quietly poisoning the dataset.
//
// Imports are left alone — `@sign` and `@studio` both alias to this folder.

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '../..')
const VENDOR = resolve(REPO, 'contribute/frontend/src/vendor')

const FILES = [
  ['frontend/src/lib/sign/poseFormat.ts', 'poseFormat.ts'],
  ['sign-studio/src/lib/holistic.ts', 'holistic.ts'],
]

const BANNER = (from) =>
  `// GENERATED — do not edit. Source of truth: ${from}\n` +
  `// Refresh with: node contribute/scripts/sync-sign-core.mjs\n`

const check = process.argv.includes('--check')
let stale = 0
let missing = 0

await mkdir(VENDOR, { recursive: true })

for (const [src, name] of FILES) {
  const dst = resolve(VENDOR, name)
  let source
  try {
    source = await readFile(resolve(REPO, src), 'utf8')
  } catch {
    // Expected on a deploy box, where only committed files exist. The vendored
    // copy is the build input there; nothing to compare against.
    console.log(`· ${src} not in this checkout — keeping vendored ${name}`)
    missing++
    continue
  }
  const wanted = BANNER(src) + source
  const current = await readFile(dst, 'utf8').catch(() => null)

  if (current === wanted) {
    console.log(`✓ ${name} up to date`)
    continue
  }
  if (check) {
    console.error(`✗ ${name} is STALE — run: node contribute/scripts/sync-sign-core.mjs`)
    stale++
    continue
  }
  await writeFile(dst, wanted)
  console.log(`✓ ${name} ← ${src}`)
}

if (stale > 0) process.exit(1)
if (check && missing === FILES.length) {
  console.log('· no sibling sources here; vendored copies used as-is')
}
