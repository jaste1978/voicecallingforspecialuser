// Put the MediaPipe runtime and the Holistic model in public/.
//
// Same job as the studio's setup script, and the model is deliberately the
// same file: a contributor's phone and a studio laptop must extract
// landmarks with identical weights, or the two halves of the dataset carry
// a systematic difference no reviewer could ever see.
//
// The model is ~10MB and is not committed. It is fetched at install time,
// and copied from a sibling checkout when one is already there.

import { cp, mkdir, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PUB = join(ROOT, 'public')
const STUDIO = resolve(ROOT, '../../sign-studio/public')

const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/holistic_landmarker/holistic_landmarker/float16/latest/holistic_landmarker.task'

async function exists(p) {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

// ---- wasm runtime ----
const wasmDst = join(PUB, 'mediapipe/wasm')
if (await exists(wasmDst)) {
  console.log('✓ mediapipe wasm already present')
} else {
  const local = join(ROOT, 'node_modules/@mediapipe/tasks-vision/wasm')
  const src = (await exists(local)) ? local : join(STUDIO, 'mediapipe/wasm')
  if (!(await exists(src))) {
    console.error('✗ no mediapipe wasm found — run npm install first')
    process.exit(1)
  }
  await mkdir(dirname(wasmDst), { recursive: true })
  await cp(src, wasmDst, { recursive: true })
  console.log('✓ mediapipe wasm → public/mediapipe/wasm')
}

// ---- holistic model ----
const modelDst = join(PUB, 'models/holistic_landmarker.task')
if (await exists(modelDst)) {
  console.log('✓ holistic model already present')
} else {
  await mkdir(dirname(modelDst), { recursive: true })
  const fromStudio = join(STUDIO, 'models/holistic_landmarker.task')
  if (await exists(fromStudio)) {
    await cp(fromStudio, modelDst)
    console.log('✓ holistic model ← sign-studio')
  } else {
    process.stdout.write('… downloading holistic model ')
    const res = await fetch(MODEL_URL)
    if (!res.ok) throw new Error(`model download failed: ${res.status}`)
    await writeFile(modelDst, Buffer.from(await res.arrayBuffer()))
    console.log('✓ downloaded')
  }
  const { size } = await stat(modelDst)
  console.log(`  ${(size / 1e6).toFixed(1)}MB → public/models/holistic_landmarker.task`)
}
