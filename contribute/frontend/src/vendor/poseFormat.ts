// GENERATED — do not edit. Source of truth: frontend/src/lib/sign/poseFormat.ts
// Refresh with: node contribute/scripts/sync-sign-core.mjs
// SunoSathi sign layer — pose clip format (Phase 3, Track B).
//
// One SignClip = one ISL phrase signed once, stored as a sequence of 2D
// keypoint frames extracted with MediaPipe Holistic. This is the training
// data for our text→pose model AND the thing the playback renderer draws,
// so the format has to stay readable, small and signer-independent.
//
// Coordinate space ("canonical signing space"), the single most important
// convention here:
//   - origin  = midpoint between the shoulders
//   - unit    = shoulder width (so shoulders sit at x = ±0.5)
//   - +x      = right on screen, +y = down on screen
// Every clip is therefore free of camera distance, framing and body size —
// a tall signer far from the camera and a short one up close produce the
// same numbers. Raw image geometry is kept per frame in `anchor` so a take
// can be re-projected onto its source video during review.
//
// Numbers are stored as integers = value × 1000 (K). Halves the JSON vs.
// decimal strings, stays diffable in git, and 1/1000 of a shoulder width is
// far below what is visible or what the sensors resolve.

export const POSE_FORMAT_VERSION = 2

/** Multiplier applied to every stored coordinate / feature. */
export const K = 1000

/**
 * Upper-body points we keep, in storage order, with their MediaPipe Pose
 * landmark index. Legs are dropped — signing happens above the hips.
 */
export const BODY_POINTS = [
  { name: 'nose', mp: 0 },
  { name: 'earL', mp: 8 },
  { name: 'earR', mp: 7 },
  { name: 'shoulderL', mp: 12 },
  { name: 'shoulderR', mp: 11 },
  { name: 'elbowL', mp: 14 },
  { name: 'elbowR', mp: 13 },
  { name: 'wristL', mp: 16 },
  { name: 'wristR', mp: 15 },
  { name: 'hipL', mp: 24 },
  { name: 'hipR', mp: 23 },
] as const

export type BodyPointName = (typeof BODY_POINTS)[number]['name']

/** Index into a frame's `body` array, by name. */
export const B: Record<BodyPointName, number> = Object.fromEntries(
  BODY_POINTS.map((p, i) => [p.name, i]),
) as Record<BodyPointName, number>

/**
 * "L"/"R" above mean left/right **as seen on screen** (the viewer's left is
 * the signer's right — mirrored, like a video call). MediaPipe names its
 * landmarks from the subject's point of view, hence the crossed mp indices.
 */

/**
 * The 27 face-mesh points we keep. The full 478-point mesh is ~18× the size
 * of everything else combined and we draw a stylised face, but ISL grammar
 * lives in the brows, eyes and mouth (raised brows = yes/no question,
 * furrowed = wh-question, mouth shape = adverbial), so these are not
 * optional decoration — they are grammar.
 */
export const FACE_POINTS = [
  { name: 'browL0', mp: 300 }, { name: 'browL1', mp: 293 }, { name: 'browL2', mp: 334 },
  { name: 'browL3', mp: 296 }, { name: 'browL4', mp: 336 },
  { name: 'browR0', mp: 70 }, { name: 'browR1', mp: 63 }, { name: 'browR2', mp: 105 },
  { name: 'browR3', mp: 66 }, { name: 'browR4', mp: 107 },
  { name: 'eyeLout', mp: 263 }, { name: 'eyeLup', mp: 386 },
  { name: 'eyeLin', mp: 362 }, { name: 'eyeLdn', mp: 374 },
  { name: 'eyeRout', mp: 33 }, { name: 'eyeRup', mp: 159 },
  { name: 'eyeRin', mp: 133 }, { name: 'eyeRdn', mp: 145 },
  { name: 'mouthL', mp: 291 }, { name: 'mouthR', mp: 61 },
  { name: 'lipTopIn', mp: 13 }, { name: 'lipBotIn', mp: 14 },
  { name: 'lipTopOut', mp: 0 }, { name: 'lipBotOut', mp: 17 },
  { name: 'noseTip', mp: 1 }, { name: 'chin', mp: 152 }, { name: 'brow', mp: 10 },
] as const

export type FacePointName = (typeof FACE_POINTS)[number]['name']

/** Index into a frame's `face` array, by name. */
export const F: Record<FacePointName, number> = Object.fromEntries(
  FACE_POINTS.map((p, i) => [p.name, i]),
) as Record<FacePointName, number>

/** MediaPipe hand landmarks are kept whole — all 21, both hands. */
export const HAND_POINT_COUNT = 21

/**
 * Facial-grammar channels, extracted at capture time so the model can be
 * trained on them directly and the renderer can exaggerate them (a 2D line
 * face needs bigger-than-life brows to read at caption size).
 *
 * All ×1000. Neutral is 0; `browRaise` and `browFurrow` are signed so a
 * frown reads as negative raise.
 */
export interface SignGrammar {
  browRaise: number // -1000 (pulled down) … +1000 (fully raised)
  browFurrow: number // 0 … 1000, inner brows drawn together
  eyeOpen: number // 0 (closed) … 1000 (wide)
  mouthOpen: number // 0 … 1000
  mouthWide: number // -1000 (pursed) … +1000 (spread / smiling)
  headTilt: number // degrees × 10, + = tilted to screen right
  headTurn: number // -1000 … +1000, + = turned to screen right
}

export const NEUTRAL_GRAMMAR: SignGrammar = {
  browRaise: 0, browFurrow: 0, eyeOpen: 600,
  mouthOpen: 0, mouthWide: 0, headTilt: 0, headTurn: 0,
}

/** Where this frame sat in the source image, for review overlays only. */
export interface FrameAnchor {
  cx: number // shoulder-midpoint x in image space, ×1000 of image width
  cy: number
  scale: number // shoulder width, ×1000 of image width
  roll: number // shoulder-line angle, degrees × 10
}

/**
 * One captured instant. Coordinate arrays are flat [x0,y0,x1,y1,…] in
 * canonical space ×1000. A hand or face that MediaPipe did not find in this
 * frame is `null` rather than zeros — "not seen" and "at the origin" are
 * very different things to a model, and the renderer holds the last known
 * pose instead of snapping a hand to the chest.
 */
export interface SignFrame {
  t: number // ms since clip start
  body: number[] // BODY_POINTS.length × 2
  handL: number[] | null // 21 × 2, screen-left hand
  handR: number[] | null // 21 × 2, screen-right hand
  face: number[] | null // FACE_POINTS.length × 2
  g: SignGrammar
  anchor: FrameAnchor
}

/** Who signed this, and on what terms. Recorded once per session. */
export interface SignerConsent {
  signerId: string // pseudonymous, e.g. "signer-01"
  displayName: string // kept local; never ships in the app bundle
  consentedAt: string // ISO date
  scope: 'research-and-product' | 'research-only'
  note: string
}

export interface SignClip {
  id: string
  format: number // POSE_FORMAT_VERSION
  phraseId: string
  /** What was signed, in the languages we caption in. */
  text: { hi: string; gu?: string; en: string }
  /** ISL gloss, upper-case, the model's target vocabulary. */
  gloss: string
  signer: SignerConsent
  fps: number // nominal capture rate; frames carry real timestamps
  durationMs: number
  frames: SignFrame[]
  /** Free-text capture notes: regional variant, facial grammar, retakes. */
  notes: string
  /** Set by the reviewer in the studio. Only `good` takes train the model. */
  quality: 'good' | 'unsure' | 'reject'
  createdAt: string
  /** Name of the sidecar video file on disk, if the take was kept. */
  video?: string
}

/** Quantise a float in canonical units to storage ints. */
export function q(v: number): number {
  return Math.round(v * K)
}

/** Storage int → float. */
export function dq(v: number): number {
  return v / K
}

/** Blend two grammar states. */
function lerpG(a: SignGrammar, b: SignGrammar, t: number): SignGrammar {
  const m = (x: number, y: number) => x + (y - x) * t
  return {
    browRaise: m(a.browRaise, b.browRaise),
    browFurrow: m(a.browFurrow, b.browFurrow),
    eyeOpen: m(a.eyeOpen, b.eyeOpen),
    mouthOpen: m(a.mouthOpen, b.mouthOpen),
    mouthWide: m(a.mouthWide, b.mouthWide),
    headTilt: m(a.headTilt, b.headTilt),
    headTurn: m(a.headTurn, b.headTurn),
  }
}

function lerpArr(a: number[] | null, b: number[] | null, t: number): number[] | null {
  if (!a) return b
  if (!b) return a
  if (a.length !== b.length) return t < 0.5 ? a : b
  const out = new Array<number>(a.length)
  for (let i = 0; i < a.length; i++) out[i] = a[i] + (b[i] - a[i]) * t
  return out
}

/**
 * Interpolate between two captured frames. Playback runs at display rate
 * (60–120Hz) off a 20–30fps capture, so without this the figure judders —
 * and jerky signing is genuinely harder to read, not just less pretty.
 */
export function lerpFrame(a: SignFrame, b: SignFrame, t: number): SignFrame {
  if (t <= 0) return a
  if (t >= 1) return b
  return {
    t: a.t + (b.t - a.t) * t,
    body: lerpArr(a.body, b.body, t) as number[],
    handL: lerpArr(a.handL, b.handL, t),
    handR: lerpArr(a.handR, b.handR, t),
    face: lerpArr(a.face, b.face, t),
    g: lerpG(a.g, b.g, t),
    anchor: a.anchor,
  }
}

/** Frame at an arbitrary time in the clip, interpolated. */
export function sampleAt(clip: SignClip, ms: number): SignFrame | null {
  const n = clip.frames.length
  if (n === 0) return null
  if (n === 1 || ms <= clip.frames[0].t) return clip.frames[0]
  if (ms >= clip.frames[n - 1].t) return clip.frames[n - 1]
  let lo = 0
  let hi = n - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (clip.frames[mid].t <= ms) lo = mid
    else hi = mid
  }
  const a = clip.frames[lo]
  const b = clip.frames[hi]
  const span = b.t - a.t
  return lerpFrame(a, b, span > 0 ? (ms - a.t) / span : 0)
}

/** Rough on-disk size of a clip, for the studio's dataset readout. */
export function clipBytes(clip: SignClip): number {
  return JSON.stringify(clip).length
}
