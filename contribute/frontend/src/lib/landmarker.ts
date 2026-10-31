// Running Holistic on a phone.
//
// The landmark→canonical-space maths is Track B's (`@studio/holistic`) and
// is imported, never reimplemented: a clip captured here and a clip captured
// in the studio land in the same training set, so any difference in that
// step would be a silent, systematic error in the dataset.
//
// What this file owns is everything the studio never had to care about,
// because the studio runs on a laptop the operator brought: an unknown
// phone, an unknown GPU, and a browser that might be Safari.

import { FilesetResolver, HolisticLandmarker } from '@mediapipe/tasks-vision'

export { baselineFrom, DEFAULT_BASELINE, extractFrame } from '@studio/holistic'
export type { Baseline, Extracted } from '@studio/holistic'

export interface LandmarkerHandle {
  landmarker: HolisticLandmarker
  delegate: 'GPU' | 'CPU'
  blendshapes: boolean
}

// Not every combination runs. On current MediaPipe builds the WebGL delegate
// cannot execute the face-blendshapes subgraph ("No support of const"), and
// it fails when the graph RUNS, not when the landmarker is created. Without
// a probe, `createFromOptions` succeeds on the GPU and then every real frame
// throws: the hand dots never light, no take ever sees a hand, and a second
// later the recorder reports "camera tracking stopped". Same list and same
// order as `sign-studio/src/lib/holistic.ts`, best first: blendshapes give
// calibration-free facial grammar, which is the part of ISL we least want to
// approximate; GPU is the difference between 25fps and 10fps on a phone.
const CANDIDATES: Array<{ delegate: 'GPU' | 'CPU'; blendshapes: boolean }> = [
  { delegate: 'GPU', blendshapes: true },
  { delegate: 'CPU', blendshapes: true },
  { delegate: 'GPU', blendshapes: false },
  { delegate: 'CPU', blendshapes: false },
]

/**
 * The first backend that actually runs a frame.
 *
 * A budget Android with a blocklisted WebGL driver is exactly the phone an
 * NGO session will hand us, and "the camera page is broken on my phone"
 * would cost us contributors we cannot afford to lose. CPU is slower, and a
 * 10fps clip is still a usable clip, because frames carry real timestamps.
 */
export async function createLandmarker(): Promise<LandmarkerHandle> {
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
      // an hour debugging a working recorder.
      console.info(
        `[contribute] using ${c.delegate}${c.blendshapes ? ' with blendshapes' : ' (geometric facial grammar)'}.`,
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

/** Longest edge we hand the detector, regardless of what the camera gives. */
const DETECT_MAX = 480

/**
 * A downscaled copy of the camera frame for the detector to chew on.
 *
 * We ask the camera for 720p because the video is archived for re-extraction
 * with better models later, but inference cost is per pixel and a phone
 * cannot afford 720p at 25fps. Landmarks come back in normalised 0–1
 * coordinates, so shrinking the image changes nothing downstream as long as
 * the aspect ratio is preserved — which is the one thing this must not get
 * wrong, since the extraction maths corrects for aspect explicitly.
 *
 * It also does NOT mirror. The preview is mirrored in CSS so signing feels
 * natural, but the pixels the detector and the recorder see stay as the
 * camera saw them, because `extractFrame` assumes an unmirrored image when
 * it decides which hand is which.
 */
export class DetectionSurface {
  private canvas = document.createElement('canvas')
  private ctx: CanvasRenderingContext2D | null = null

  /** Sized from the video; returns null until the video has dimensions. */
  update(video: HTMLVideoElement): HTMLCanvasElement | null {
    const vw = video.videoWidth
    const vh = video.videoHeight
    if (!vw || !vh) return null

    const scale = Math.min(1, DETECT_MAX / Math.max(vw, vh))
    const w = Math.round(vw * scale)
    const h = Math.round(vh * scale)
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w
      this.canvas.height = h
      this.ctx = this.canvas.getContext('2d', { willReadFrequently: false })
    }
    if (!this.ctx) return null
    this.ctx.drawImage(video, 0, 0, w, h)
    return this.canvas
  }
}

/**
 * The container MediaRecorder will actually give us on this browser.
 *
 * Chrome and Firefox produce webm; Safari produces mp4 and supports nothing
 * else. Codecs are stripped from the returned string because the presigned
 * upload is signed for an exact Content-Type, and `video/webm;codecs=vp9`
 * is not `video/webm` as far as the signature is concerned.
 */
export function pickVideoMime(): { record: string; store: string } | null {
  if (typeof MediaRecorder === 'undefined') return null
  const candidates = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
    'video/mp4;codecs=avc1',
    'video/mp4',
  ]
  for (const record of candidates) {
    if (MediaRecorder.isTypeSupported(record)) {
      return { record, store: record.split(';')[0].trim() }
    }
  }
  return null
}
