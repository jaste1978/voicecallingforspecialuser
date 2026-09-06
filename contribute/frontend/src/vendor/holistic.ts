// GENERATED — do not edit. Source of truth: sign-studio/src/lib/holistic.ts
// Refresh with: node contribute/scripts/sync-sign-core.mjs
// MediaPipe Holistic → SignFrame.
//
// Everything about turning what the camera sees into signer-independent
// training data lives here. Two decisions worth knowing about:
//
// 1. We normalise by shoulder width and shoulder midpoint, but we do NOT
//    de-rotate by shoulder roll. Leaning and body shift are ISL grammar
//    (role shift, topic marking) — "straightening" the signer would erase
//    meaning, not noise.
// 2. Face landmarks are kept AND reduced to seven grammar channels. Raw
//    points give a future model maximum information; the channels are what
//    the renderer exaggerates so a raised-brow question still reads when the
//    figure is 80 pixels tall.

import { FilesetResolver, HolisticLandmarker } from '@mediapipe/tasks-vision'
import type { HolisticLandmarkerResult, NormalizedLandmark } from '@mediapipe/tasks-vision'
import { BODY_POINTS, B, FACE_POINTS, F, q } from '@sign/poseFormat'
import type { FrameAnchor, SignFrame, SignGrammar } from '@sign/poseFormat'

/** Which backend actually runs, and whether we get blendshapes from it. */
export interface LandmarkerInfo {
  landmarker: HolisticLandmarker
  delegate: 'GPU' | 'CPU'
  blendshapes: boolean
}

// Not every combination runs. On current MediaPipe builds the WebGL delegate
// cannot execute the face-blendshapes subgraph at all ("No support of const")
// — and it fails when the graph RUNS, not when it is created, so without a
// probe the first failure would land on the signer's first take. Ordered
// best-first: blendshapes give calibration-free facial grammar, which is the
// part of ISL we least want to approximate.
const CANDIDATES: Array<{ delegate: 'GPU' | 'CPU'; blendshapes: boolean }> = [
  { delegate: 'GPU', blendshapes: true },
  { delegate: 'CPU', blendshapes: true },
  { delegate: 'GPU', blendshapes: false },
  { delegate: 'CPU', blendshapes: false },
]

export async function createLandmarker(): Promise<LandmarkerInfo> {
  const fileset = await FilesetResolver.forVisionTasks('/mediapipe/wasm')
  const probe = document.createElement('canvas')
  probe.width = 64
  probe.height = 64
  probe.getContext('2d')?.fillRect(0, 0, 64, 64)

  const failures: string[] = []
  for (const c of CANDIDATES) {
    let lm: HolisticLandmarker | null = null
    try {
      lm = await HolisticLandmarker.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath: '/models/holistic_landmarker.task',
          delegate: c.delegate,
        },
        runningMode: 'VIDEO',
        outputFaceBlendshapes: c.blendshapes,
        minHandLandmarksConfidence: 0.4,
      })
      lm.detectForVideo(probe, performance.now())
      // Rejected candidates dump a wall of MediaPipe errors to the console
      // on the way here. Say so, or the next person to open devtools spends
      // an hour debugging a working tool.
      console.info(
        `[sign-studio] using ${c.delegate}${c.blendshapes ? ' with blendshapes' : ' (geometric facial grammar)'}.`,
        failures.length ? `Preceding MediaPipe errors are rejected probes: ${failures.length}.` : '',
      )
      return { landmarker: lm, ...c }
    } catch (err) {
      lm?.close()
      failures.push(`${c.delegate}${c.blendshapes ? '+blendshapes' : ''}: ${err instanceof Error ? err.message.split('\n')[0] : err}`)
    }
  }
  throw new Error(`MediaPipe Holistic would not run.\n${failures.join('\n')}`)
}

/** Neutral-face reference measured at session start, per signer. */
export interface Baseline {
  browEye: number // brow-to-eye distance / eye width
  browGap: number // inner-brow gap / eye width
  eyeOpen: number // lid gap / eye width
  mouthOpen: number
  mouthWide: number
}

export const DEFAULT_BASELINE: Baseline = {
  browEye: 0.62, browGap: 1.35, eyeOpen: 0.33, mouthOpen: 0.06, mouthWide: 1.05,
}

interface Iso {
  x: number
  y: number
}

/**
 * MediaPipe hands out x as a fraction of width and y as a fraction of
 * height, so on a 16:9 camera a circle is not a circle. Multiplying x by the
 * aspect ratio puts both axes in the same unit before we measure anything.
 */
function iso(l: NormalizedLandmark, aspect: number): Iso {
  return { x: l.x * aspect, y: l.y }
}

const dist = (a: Iso, b: Iso) => Math.hypot(a.x - b.x, a.y - b.y)
const mid = (a: Iso, b: Iso): Iso => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

function packInto(
  out: number[], pts: Iso[], origin: Iso, scale: number,
) {
  for (const p of pts) {
    out.push(q((p.x - origin.x) / scale), q((p.y - origin.y) / scale))
  }
}

function blendshapeMap(result: HolisticLandmarkerResult): Map<string, number> | null {
  const cats = result.faceBlendshapes?.[0]?.categories
  if (!cats || cats.length === 0) return null
  const m = new Map<string, number>()
  for (const c of cats) if (c.categoryName) m.set(c.categoryName, c.score)
  return m
}

/**
 * Grammar from blendshapes when the model gives them (calibration-free and
 * robust across faces), from raw geometry against the session baseline
 * otherwise.
 */
function grammarFrom(
  face: Iso[] | null, bs: Map<string, number> | null, base: Baseline, body: Iso[],
): SignGrammar {
  const g: SignGrammar = {
    browRaise: 0, browFurrow: 0, eyeOpen: 600,
    mouthOpen: 0, mouthWide: 0, headTilt: 0, headTurn: 0,
  }

  // head tilt / turn are always geometric — no blendshape covers them
  const earL = body[B.earL]
  const earR = body[B.earR]
  const nose = body[B.nose]
  const earSpan = dist(earL, earR)
  if (earSpan > 1e-4) {
    g.headTilt = Math.round((Math.atan2(earL.y - earR.y, earL.x - earR.x) * 180) / Math.PI * 10)
    const c = mid(earL, earR)
    g.headTurn = Math.round(clamp(((nose.x - c.x) / earSpan) * 3.4, -1, 1) * 1000)
  }

  if (bs) {
    const v = (n: string) => bs.get(n) ?? 0
    const browUp = Math.max(v('browInnerUp'), (v('browOuterUpLeft') + v('browOuterUpRight')) / 2)
    const browDown = (v('browDownLeft') + v('browDownRight')) / 2
    const blink = (v('eyeBlinkLeft') + v('eyeBlinkRight')) / 2
    const smile = (v('mouthSmileLeft') + v('mouthSmileRight')) / 2
    g.browRaise = Math.round(clamp(browUp - browDown, -1, 1) * 1000)
    g.browFurrow = Math.round(clamp(browDown, 0, 1) * 1000)
    g.eyeOpen = Math.round(clamp(1 - blink, 0, 1) * 1000)
    g.mouthOpen = Math.round(clamp(v('jawOpen') * 1.6, 0, 1) * 1000)
    g.mouthWide = Math.round(clamp(smile * 1.5 - v('mouthPucker'), -1, 1) * 1000)
    return g
  }

  if (!face) return g
  const eyeW = (dist(face[F.eyeLout], face[F.eyeLin]) + dist(face[F.eyeRout], face[F.eyeRin])) / 2
  if (eyeW < 1e-5) return g
  const lid = (dist(face[F.eyeLup], face[F.eyeLdn]) + dist(face[F.eyeRup], face[F.eyeRdn])) / 2 / eyeW
  const browEye = (dist(face[F.browL2], face[F.eyeLup]) + dist(face[F.browR2], face[F.eyeRup])) / 2 / eyeW
  const browGap = dist(face[F.browL4], face[F.browR4]) / eyeW
  const mOpen = dist(face[F.lipTopIn], face[F.lipBotIn]) / eyeW
  const mWide = dist(face[F.mouthL], face[F.mouthR]) / eyeW

  g.browRaise = Math.round(clamp((browEye - base.browEye) / (base.browEye * 0.45), -1, 1) * 1000)
  g.browFurrow = Math.round(clamp((base.browGap - browGap) / (base.browGap * 0.25), 0, 1) * 1000)
  g.eyeOpen = Math.round(clamp(lid / (base.eyeOpen * 1.15), 0, 1) * 1000)
  g.mouthOpen = Math.round(clamp((mOpen - base.mouthOpen) / 0.6, 0, 1) * 1000)
  g.mouthWide = Math.round(clamp((mWide - base.mouthWide) / (base.mouthWide * 0.3), -1, 1) * 1000)
  return g
}

export interface Extracted {
  frame: SignFrame
  /** Quality signals shown live so the operator can fix framing mid-session. */
  sawBody: boolean
  sawFace: boolean
  sawHandL: boolean
  sawHandR: boolean
  /** Raw normalised measurements, for neutral calibration. */
  measure: Baseline | null
}

/**
 * Turn one Holistic result into a canonical-space frame. Returns null when
 * there is no usable upper body — a frame with no shoulders has no scale,
 * and guessing one would poison the dataset silently.
 */
export function extractFrame(
  result: HolisticLandmarkerResult, tMs: number, aspect: number, base: Baseline,
): Extracted | null {
  const pose = result.poseLandmarks?.[0]
  if (!pose || pose.length < 25) return null

  const bodyIso = BODY_POINTS.map((p) => iso(pose[p.mp], aspect))
  const sL = bodyIso[B.shoulderL]
  const sR = bodyIso[B.shoulderR]
  const scale = dist(sL, sR)
  if (scale < 0.02) return null // signer far too small in frame to be usable
  const origin = mid(sL, sR)

  const faceRaw = result.faceLandmarks?.[0]
  const faceIso = faceRaw && faceRaw.length > 400
    ? FACE_POINTS.map((p) => iso(faceRaw[p.mp], aspect))
    : null

  // MediaPipe names hands from the signer's point of view; the camera image
  // is not mirrored, so the signer's left hand appears on the viewer's right.
  const handRRaw = result.leftHandLandmarks?.[0]
  const handLRaw = result.rightHandLandmarks?.[0]

  const body: number[] = []
  packInto(body, bodyIso, origin, scale)

  let handL: number[] | null = null
  if (handLRaw?.length === 21) {
    handL = []
    packInto(handL, handLRaw.map((l) => iso(l, aspect)), origin, scale)
  }
  let handR: number[] | null = null
  if (handRRaw?.length === 21) {
    handR = []
    packInto(handR, handRRaw.map((l) => iso(l, aspect)), origin, scale)
  }
  let face: number[] | null = null
  if (faceIso) {
    face = []
    packInto(face, faceIso, origin, scale)
  }

  const anchor: FrameAnchor = {
    cx: Math.round((origin.x / aspect) * 1000),
    cy: Math.round(origin.y * 1000),
    scale: Math.round((scale / aspect) * 1000),
    roll: Math.round((Math.atan2(sL.y - sR.y, sL.x - sR.x) * 180) / Math.PI * 10),
  }

  const g = grammarFrom(faceIso, blendshapeMap(result), base, bodyIso)

  return {
    frame: { t: Math.round(tMs), body, handL, handR, face, g, anchor },
    sawBody: true,
    sawFace: !!faceIso,
    sawHandL: !!handL,
    sawHandR: !!handR,
    measure: faceIso ? measureFace(faceIso) : null,
  }
}

/** Raw face ratios for the neutral-calibration step. */
function measureFace(face: Iso[]): Baseline | null {
  const eyeW = (dist(face[F.eyeLout], face[F.eyeLin]) + dist(face[F.eyeRout], face[F.eyeRin])) / 2
  if (eyeW < 1e-5) return null
  return {
    browEye: (dist(face[F.browL2], face[F.eyeLup]) + dist(face[F.browR2], face[F.eyeRup])) / 2 / eyeW,
    browGap: dist(face[F.browL4], face[F.browR4]) / eyeW,
    eyeOpen: (dist(face[F.eyeLup], face[F.eyeLdn]) + dist(face[F.eyeRup], face[F.eyeRdn])) / 2 / eyeW,
    mouthOpen: dist(face[F.lipTopIn], face[F.lipBotIn]) / eyeW,
    mouthWide: dist(face[F.mouthL], face[F.mouthR]) / eyeW,
  }
}

/** Median of the calibration samples — robust to a blink mid-capture. */
export function baselineFrom(samples: Baseline[]): Baseline {
  if (samples.length === 0) return DEFAULT_BASELINE
  const pick = (k: keyof Baseline) => {
    const xs = samples.map((s) => s[k]).sort((a, b) => a - b)
    return xs[Math.floor(xs.length / 2)]
  }
  return {
    browEye: pick('browEye'), browGap: pick('browGap'), eyeOpen: pick('eyeOpen'),
    mouthOpen: pick('mouthOpen'), mouthWide: pick('mouthWide'),
  }
}
