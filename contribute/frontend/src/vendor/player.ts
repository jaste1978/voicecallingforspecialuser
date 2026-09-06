// GENERATED — do not edit. Source of truth: frontend/src/lib/sign/player.ts
// Refresh with: node contribute/scripts/sync-sign-core.mjs
// Playback loop for pose clips: time-based, display-rate, speed-adjustable.
//
// Signing has to keep up with speech, so speed control is a first-class
// feature rather than a debug knob (1.25–1.5× is normal practice in sign
// captioning). Playback is driven off wall-clock time, not frame counting,
// so a slow phone drops frames instead of signing in slow motion.

import { B, dq, sampleAt } from './poseFormat'
import type { SignClip, SignFrame } from './poseFormat'
import { drawFrame, fitCanvas, restFrame } from './renderPose'
import type { RenderOptions } from './renderPose'

export interface PlayerOptions extends RenderOptions {
  speed?: number
  loop?: boolean
  /** Length of the fading wrist trail, in frames of history. */
  trail?: number
  onEnd?: () => void
  onProgress?: (ms: number, total: number) => void
}

const TRAIL_MAX = 14

export class SignPlayer {
  private canvas: HTMLCanvasElement
  private opts: PlayerOptions
  private clip: SignClip | null = null
  private raf = 0
  private startedAt = 0
  private offsetMs = 0
  private playing = false
  private trailL: number[][] = []
  private trailR: number[][] = []
  private lastHandL: number[] | null = null
  private lastHandR: number[] | null = null
  private lastFace: number[] | null = null

  constructor(canvas: HTMLCanvasElement, opts: PlayerOptions = {}) {
    this.canvas = canvas
    this.opts = opts
  }

  setOptions(opts: PlayerOptions) {
    this.opts = { ...this.opts, ...opts }
    if (!this.playing) this.redraw()
  }

  load(clip: SignClip | null) {
    this.clip = clip
    this.offsetMs = 0
    this.resetCarry()
    this.redraw()
  }

  get duration(): number {
    return this.clip?.durationMs ?? 0
  }

  get isPlaying(): boolean {
    return this.playing
  }

  play(fromStart = true) {
    if (!this.clip || this.clip.frames.length === 0) return
    if (fromStart) {
      this.offsetMs = 0
      this.resetCarry()
    }
    this.playing = true
    this.startedAt = performance.now()
    cancelAnimationFrame(this.raf)
    this.raf = requestAnimationFrame(this.tick)
  }

  pause() {
    if (!this.playing) return
    this.offsetMs = this.currentMs()
    this.playing = false
    cancelAnimationFrame(this.raf)
  }

  stop() {
    this.playing = false
    cancelAnimationFrame(this.raf)
    this.offsetMs = 0
    this.resetCarry()
    this.redraw()
  }

  seek(ms: number) {
    this.offsetMs = Math.max(0, Math.min(ms, this.duration))
    this.startedAt = performance.now()
    this.resetCarry()
    this.redraw()
  }

  destroy() {
    this.playing = false
    cancelAnimationFrame(this.raf)
  }

  /** Draw a single frame without running the loop (studio scrubbing). */
  drawFrameAt(ms: number) {
    this.offsetMs = ms
    this.redraw()
  }

  private resetCarry() {
    this.trailL = []
    this.trailR = []
    this.lastHandL = null
    this.lastHandR = null
    this.lastFace = null
  }

  private currentMs(): number {
    if (!this.playing) return this.offsetMs
    const speed = this.opts.speed ?? 1
    return this.offsetMs + (performance.now() - this.startedAt) * speed
  }

  private tick = () => {
    if (!this.playing || !this.clip) return
    const ms = this.currentMs()
    const total = this.duration
    if (ms >= total) {
      this.paint(total)
      this.opts.onProgress?.(total, total)
      if (this.opts.loop) {
        this.offsetMs = 0
        this.startedAt = performance.now()
        this.resetCarry()
        this.raf = requestAnimationFrame(this.tick)
        return
      }
      this.playing = false
      this.opts.onEnd?.()
      return
    }
    this.paint(ms)
    this.opts.onProgress?.(ms, total)
    this.raf = requestAnimationFrame(this.tick)
  }

  private redraw() {
    this.paint(this.offsetMs)
  }

  private paint(ms: number) {
    const surface = fitCanvas(this.canvas)
    if (!surface) return
    const { ctx, w, h } = surface
    const frame: SignFrame | null = this.clip ? sampleAt(this.clip, ms) : restFrame()
    if (!frame) return

    if (frame.handL) this.lastHandL = frame.handL
    if (frame.handR) this.lastHandR = frame.handR
    if (frame.face) this.lastFace = frame.face

    const trailLen = this.opts.trail ?? 0
    if (trailLen > 0) {
      pushTrail(this.trailL, frame, B.wristL, Math.min(trailLen, TRAIL_MAX))
      pushTrail(this.trailR, frame, B.wristR, Math.min(trailLen, TRAIL_MAX))
    }

    drawFrame(ctx, w, h, frame, {
      ...this.opts,
      trailL: trailLen > 0 ? this.trailL : undefined,
      trailR: trailLen > 0 ? this.trailR : undefined,
      fallback: { handL: this.lastHandL, handR: this.lastHandR, face: this.lastFace },
    })
  }
}

function pushTrail(trail: number[][], frame: SignFrame, idx: number, max: number) {
  const x = dq(frame.body[idx * 2])
  const y = dq(frame.body[idx * 2 + 1])
  const last = trail[trail.length - 1]
  if (last && Math.hypot(last[0] - x, last[1] - y) < 0.01) return
  trail.push([x, y])
  while (trail.length > max) trail.shift()
}
