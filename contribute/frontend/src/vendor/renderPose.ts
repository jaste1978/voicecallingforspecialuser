// GENERATED — do not edit. Source of truth: frontend/src/lib/sign/renderPose.ts
// Refresh with: node contribute/scripts/sync-sign-core.mjs
// 2D line-figure renderer for captured ISL pose clips.
//
// Draws a SignFrame in the SunoSathi brand hand: round-capped ink strokes on
// warm cream, hands in burnt orange because handshape is where the meaning
// is. No 3D, no rig, no video — just the same visual language as the logo,
// which keeps the sign strip looking like part of the app instead of a
// window into someone else's product.
//
// Deliberately free of React and of MediaPipe: the capture studio and the
// call screen both draw with this, and the app bundle must not pay for the
// capture toolchain.

import { B, dq, NEUTRAL_GRAMMAR } from './poseFormat'
import type { SignFrame, SignGrammar } from './poseFormat'
import {
  ARM_BONES, FACE_STROKES, FINGERTIPS, HAND_BONES, SHOULDER_BONE, TORSO_PATH,
} from './skeleton'

export interface SignTheme {
  ink: string
  accent: string
  bg: string | null // null = draw nothing, let the page show through
  /** Body fill. Gives the hands something to sit on top of. */
  tint: string
}

export const BRAND_THEME: SignTheme = {
  ink: '#241B12',
  accent: '#E4590A',
  bg: '#FFF8F1',
  tint: '#FFEFE0',
}

export interface RenderOptions {
  theme?: SignTheme
  /** Stylised reads better at caption size; landmarks is for studio QA. */
  faceStyle?: 'stylised' | 'landmarks'
  /** Fraction of the canvas the figure fills. */
  fit?: number
  /** Fading wrist trails — movement is part of the sign, not decoration. */
  trailL?: number[][]
  trailR?: number[][]
  /** Last-known parts, used while MediaPipe has momentarily lost a hand. */
  fallback?: { handL?: number[] | null; handR?: number[] | null; face?: number[] | null }
  /** Scales every stroke; >1 for small strip renders. */
  weight?: number
}

// Canonical signing space the figure is fitted into: wide enough for both
// arms fully extended, tall enough for a sign made above the head, and no
// taller — empty canvas is stroke weight we don't get to spend.
const SPACE_W = 3.0
const SPACE_H = 2.4
const ORIGIN_Y = 0.46 // shoulder line sits a little above centre

interface View {
  s: number
  ox: number
  oy: number
}

function view(w: number, h: number, fit: number): View {
  const s = Math.min(w / SPACE_W, h / SPACE_H) * fit
  return { s, ox: w / 2, oy: h * ORIGIN_Y }
}

const px = (v: View, x: number) => v.ox + x * v.s
const py = (v: View, y: number) => v.oy + y * v.s

/** Read point i out of a flat quantised array, in canonical units. */
function pt(arr: number[], i: number): [number, number] {
  return [dq(arr[i * 2]), dq(arr[i * 2 + 1])]
}

function path(ctx: CanvasRenderingContext2D, v: View, arr: number[], idx: number[], close: boolean) {
  ctx.beginPath()
  for (let i = 0; i < idx.length; i++) {
    const [x, y] = pt(arr, idx[i])
    if (i === 0) ctx.moveTo(px(v, x), py(v, y))
    else ctx.lineTo(px(v, x), py(v, y))
  }
  if (close) ctx.closePath()
}

/**
 * Rounded polygon through the given body points. Straight-line torsos read
 * as machinery; the brand mark is all round caps and curves, and the figure
 * has to look like it belongs to the same drawing.
 */
function roundedPath(
  ctx: CanvasRenderingContext2D, v: View, arr: number[], idx: number[], radius: number,
) {
  const p = idx.map((i) => {
    const [x, y] = pt(arr, i)
    return [px(v, x), py(v, y)] as [number, number]
  })
  const n = p.length
  const r = radius * v.s
  ctx.beginPath()
  for (let i = 0; i < n; i++) {
    const prev = p[(i - 1 + n) % n]
    const cur = p[i]
    const next = p[(i + 1) % n]
    const toPrev = trim(cur, prev, r)
    const toNext = trim(cur, next, r)
    if (i === 0) ctx.moveTo(toPrev[0], toPrev[1])
    else ctx.lineTo(toPrev[0], toPrev[1])
    ctx.quadraticCurveTo(cur[0], cur[1], toNext[0], toNext[1])
  }
  ctx.closePath()
}

function trim(from: [number, number], to: [number, number], r: number): [number, number] {
  const dx = to[0] - from[0]
  const dy = to[1] - from[1]
  const len = Math.hypot(dx, dy) || 1
  const k = Math.min(r, len / 2) / len
  return [from[0] + dx * k, from[1] + dy * k]
}

function stroke(
  ctx: CanvasRenderingContext2D, v: View, arr: number[], idx: number[],
  color: string, width: number, close = false,
) {
  if (idx.length < 2) return
  path(ctx, v, arr, idx, close)
  ctx.strokeStyle = color
  ctx.lineWidth = width * v.s
  ctx.stroke()
}

function dot(ctx: CanvasRenderingContext2D, v: View, x: number, y: number, r: number, color: string) {
  ctx.beginPath()
  ctx.arc(px(v, x), py(v, y), r * v.s, 0, Math.PI * 2)
  ctx.fillStyle = color
  ctx.fill()
}

/** Prepare a canvas for a device-pixel-sharp draw. Returns CSS-pixel size. */
export function fitCanvas(canvas: HTMLCanvasElement): { ctx: CanvasRenderingContext2D; w: number; h: number } | null {
  const rect = canvas.getBoundingClientRect()
  const w = Math.max(1, Math.round(rect.width || canvas.clientWidth || 240))
  const h = Math.max(1, Math.round(rect.height || canvas.clientHeight || 240))
  const dpr = Math.min(window.devicePixelRatio || 1, 3)
  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = w * dpr
    canvas.height = h * dpr
  }
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  return { ctx, w, h }
}

function drawHand(
  ctx: CanvasRenderingContext2D, v: View, hand: number[], theme: SignTheme, weight: number,
) {
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const [a, c] of HAND_BONES) {
    const [ax, ay] = pt(hand, a)
    const [cx, cy] = pt(hand, c)
    ctx.beginPath()
    ctx.moveTo(px(v, ax), py(v, ay))
    ctx.lineTo(px(v, cx), py(v, cy))
    ctx.strokeStyle = theme.accent
    ctx.lineWidth = 0.045 * weight * v.s
    ctx.stroke()
  }
  for (const tip of FINGERTIPS) {
    const [x, y] = pt(hand, tip)
    dot(ctx, v, x, y, 0.032 * weight, theme.accent)
  }
  // wrist anchor, so a hand never looks detached from its arm
  const [wx, wy] = pt(hand, 0)
  dot(ctx, v, wx, wy, 0.036 * weight, theme.accent)
}

function drawTrail(
  ctx: CanvasRenderingContext2D, v: View, trail: number[][], theme: SignTheme, weight: number,
) {
  if (trail.length < 2) return
  ctx.lineCap = 'round'
  for (let i = 1; i < trail.length; i++) {
    const a = trail[i - 1]
    const c = trail[i]
    const age = i / trail.length
    ctx.beginPath()
    ctx.moveTo(px(v, a[0]), py(v, a[1]))
    ctx.lineTo(px(v, c[0]), py(v, c[1]))
    ctx.globalAlpha = 0.32 * age
    ctx.strokeStyle = theme.accent
    ctx.lineWidth = 0.05 * weight * age * v.s
    ctx.stroke()
  }
  ctx.globalAlpha = 1
}

/**
 * A stylised face driven by the grammar channels rather than by raw
 * landmarks. Raw face points are ~4% of the figure's height and read as
 * noise at strip size; exaggerating brows, eyes and mouth is what makes
 * "this is a question" survive being drawn 80px tall.
 */
function drawFace(
  ctx: CanvasRenderingContext2D, v: View,
  cx: number, cy: number, r: number, g: SignGrammar, theme: SignTheme, weight: number,
) {
  const raise = g.browRaise / 1000
  const furrow = Math.max(0, g.browFurrow / 1000)
  const open = Math.max(0, Math.min(1, g.eyeOpen / 1000))
  const mOpen = Math.max(0, g.mouthOpen / 1000)
  const mWide = g.mouthWide / 1000
  const turn = Math.max(-1, Math.min(1, g.headTurn / 1000))
  const tilt = (g.headTilt / 10) * (Math.PI / 180)

  ctx.save()
  ctx.translate(px(v, cx), py(v, cy))
  ctx.rotate(tilt)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  const R = r * v.s
  const shift = turn * 0.16 * R // features slide as the head turns
  const lw = 0.055 * weight * v.s
  ctx.strokeStyle = theme.ink
  ctx.lineWidth = lw

  for (const side of [-1, 1]) {
    const ex = side * 0.36 * R + shift
    const ey = -0.02 * R
    // eye: an arc when open, a flat line when closed or squinting
    ctx.beginPath()
    if (open > 0.25) {
      ctx.ellipse(ex, ey, 0.13 * R, 0.13 * R * open, 0, 0, Math.PI * 2)
      ctx.fillStyle = theme.ink
      ctx.fill()
    } else {
      ctx.moveTo(ex - 0.14 * R, ey)
      ctx.lineTo(ex + 0.14 * R, ey)
      ctx.stroke()
    }

    // brow: raised = high and arched, furrowed = inner end pulled down/in
    const inner = -side * 0.14 * R
    const outer = side * 0.16 * R
    const base = ey - (0.30 + raise * 0.16) * R
    const innerY = base + furrow * 0.13 * R
    ctx.beginPath()
    ctx.moveTo(ex + inner - side * furrow * 0.04 * R, innerY)
    ctx.quadraticCurveTo(ex, base - (0.05 + raise * 0.05) * R, ex + outer, base + 0.02 * R)
    ctx.stroke()
  }

  // mouth: a curve that spreads, purses and opens
  const mw = (0.26 + mWide * 0.12) * R
  const my = 0.42 * R
  ctx.beginPath()
  if (mOpen > 0.12) {
    ctx.ellipse(shift * 0.6, my, mw * 0.7, mOpen * 0.26 * R + 0.03 * R, 0, 0, Math.PI * 2)
  } else {
    ctx.moveTo(shift * 0.6 - mw, my - mWide * 0.06 * R)
    ctx.quadraticCurveTo(shift * 0.6, my + (0.10 + mWide * 0.10) * R, shift * 0.6 + mw, my - mWide * 0.06 * R)
  }
  ctx.stroke()
  ctx.restore()
}

/** Head centre and radius, derived from ears/nose with a sane fallback. */
function headGeometry(body: number[]): { cx: number; cy: number; r: number } {
  const [elx, ely] = pt(body, B.earL)
  const [erx, ery] = pt(body, B.earR)
  const [nx, ny] = pt(body, B.nose)
  const earSpan = Math.hypot(elx - erx, ely - ery)
  // a touch larger than anatomy, deliberately: the face carries grammar and
  // has to stay legible when the whole figure is 88px tall
  const r = earSpan > 0.05 ? Math.min(0.40, Math.max(0.28, earSpan * 0.82)) : 0.32
  const cx = (elx + erx) / 2 || nx
  const cy = (ely + ery) / 2 || ny - 0.1
  return { cx, cy, r }
}

/** Draw one frame. The canvas is cleared unless the theme has bg = null. */
export function drawFrame(
  ctx: CanvasRenderingContext2D, w: number, h: number, frame: SignFrame, opts: RenderOptions = {},
) {
  const theme = opts.theme ?? BRAND_THEME
  const weight = opts.weight ?? 1
  const v = view(w, h, opts.fit ?? 0.92)

  ctx.clearRect(0, 0, w, h)
  if (theme.bg) {
    ctx.fillStyle = theme.bg
    ctx.fillRect(0, 0, w, h)
  }

  const body = frame.body
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  if (opts.trailL) drawTrail(ctx, v, opts.trailL, theme, weight)
  if (opts.trailR) drawTrail(ctx, v, opts.trailR, theme, weight)

  const head = headGeometry(body)
  const [slx, sly] = pt(body, B.shoulderL)
  const [srx, sry] = pt(body, B.shoulderR)
  const neckX = (slx + srx) / 2
  const neckY = (sly + sry) / 2

  // torso — filled, lightly outlined. The fill is what lets an orange hand
  // crossing the chest still read as a hand rather than as more line work.
  roundedPath(ctx, v, body, TORSO_PATH, 0.22)
  ctx.fillStyle = theme.tint
  ctx.fill()
  ctx.strokeStyle = theme.ink
  ctx.lineWidth = 0.05 * weight * v.s
  ctx.stroke()
  stroke(ctx, v, body, [SHOULDER_BONE[0], SHOULDER_BONE[1]], theme.ink, 0.07 * weight)

  // neck, drawn before the head so the join disappears under it
  ctx.beginPath()
  ctx.moveTo(px(v, neckX), py(v, neckY))
  ctx.lineTo(px(v, head.cx), py(v, head.cy))
  ctx.strokeStyle = theme.ink
  ctx.lineWidth = 0.11 * weight * v.s
  ctx.stroke()

  // arms, on top of the torso
  for (const [a, c] of ARM_BONES) {
    const [ax, ay] = pt(body, a)
    const [cx, cy] = pt(body, c)
    ctx.beginPath()
    ctx.moveTo(px(v, ax), py(v, ay))
    ctx.lineTo(px(v, cx), py(v, cy))
    ctx.strokeStyle = theme.ink
    ctx.lineWidth = 0.09 * weight * v.s
    ctx.stroke()
  }

  // head
  ctx.beginPath()
  ctx.arc(px(v, head.cx), py(v, head.cy), head.r * v.s, 0, Math.PI * 2)
  ctx.fillStyle = theme.tint
  ctx.fill()
  ctx.strokeStyle = theme.ink
  ctx.lineWidth = 0.06 * weight * v.s
  ctx.stroke()

  const face = frame.face ?? opts.fallback?.face ?? null
  if (opts.faceStyle === 'landmarks' && face) {
    for (const s of FACE_STROKES) stroke(ctx, v, face, s, theme.ink, 0.02 * weight)
  } else {
    drawFace(ctx, v, head.cx, head.cy, head.r, frame.g ?? NEUTRAL_GRAMMAR, theme, weight)
  }

  // hands last — they sit on top of everything, as the eye should
  const hl = frame.handL ?? opts.fallback?.handL ?? null
  const hr = frame.handR ?? opts.fallback?.handR ?? null
  if (hl) drawHand(ctx, v, hl, theme, weight)
  if (hr) drawHand(ctx, v, hr, theme, weight)
}

/** Draw an "at rest" figure — used as the strip's idle state. */
export function restFrame(): SignFrame {
  const body: number[] = new Array(22).fill(0)
  const set = (i: number, x: number, y: number) => {
    body[i * 2] = Math.round(x * 1000)
    body[i * 2 + 1] = Math.round(y * 1000)
  }
  set(B.nose, 0, -0.52)
  set(B.earL, 0.20, -0.58)
  set(B.earR, -0.20, -0.58)
  set(B.shoulderL, 0.5, 0)
  set(B.shoulderR, -0.5, 0)
  set(B.elbowL, 0.62, 0.52)
  set(B.elbowR, -0.62, 0.52)
  set(B.wristL, 0.58, 1.0)
  set(B.wristR, -0.58, 1.0)
  set(B.hipL, 0.34, 1.16)
  set(B.hipR, -0.34, 1.16)
  return {
    t: 0, body, handL: null, handR: null, face: null,
    g: { ...NEUTRAL_GRAMMAR },
    anchor: { cx: 500, cy: 500, scale: 300, roll: 0 },
  }
}
