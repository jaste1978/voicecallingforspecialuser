// The record loop: phrase → camera → keypoints → submit.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { HolisticLandmarker } from '@mediapipe/tasks-vision'
import type { SignFrame } from '@sign/poseFormat'
import type { Coverage, Phrase } from '../lib/api'
import {
  createLandmarker, DEFAULT_BASELINE, DetectionSurface, extractFrame, pickVideoMime,
} from '../lib/landmarker'
import type { Lang } from '../lib/device'

export interface Take {
  frames: SignFrame[]
  durationMs: number
  fps: number
  coverage: Coverage
  video: Blob | null
  videoMime: string
}

interface Props {
  phrase: Phrase
  lang: Lang
  busy: boolean
  onSubmit: (take: Take) => void
  onSkip: () => void
}

type Mode = 'boot' | 'ready' | 'countdown' | 'recording' | 'review'

const COUNTDOWN_MS = 3000
const MAX_RECORD_MS = 7000
const MIN_RECORD_MS = 700
/** Below this share of frames, the face was not really in shot. ISL grammar
 *  lives in the brows and mouth, so a faceless clip is not half a clip. */
const FACE_MIN = 0.5
/** Consecutive failed detections before we admit the camera pipeline is
 *  wedged rather than merely having a bad moment. */
const FAIL_LIMIT = 30

const T = {
  hi: {
    record: 'रिकॉर्ड करें', stop: 'रुकें', again: 'फिर से', submit: 'भेजें',
    skip: 'छोड़ें', sending: 'भेजा जा रहा है…', starting: 'कैमरा शुरू हो रहा है…',
    loading: 'तैयार हो रहा है…', hold: 'फ़ोन को कहीं टिकाकर रखें',
    body: 'शरीर', face: 'चेहरा', handL: 'बायाँ हाथ', handR: 'दायाँ हाथ',
    noFace: 'चेहरा साफ़ नहीं दिखा। ISL में भाव भी मायने रखते हैं — थोड़ा पीछे हटें।',
    noHands: 'हाथ दिखे ही नहीं। दोबारा कोशिश करें।',
    tooShort: 'बहुत छोटा। साइन पूरा करके रुकें।',
    stalled: 'कैमरा ट्रैकिंग रुक गई। पेज दोबारा खोलें।',
  },
  en: {
    record: 'Record', stop: 'Stop', again: 'Redo', submit: 'Send',
    skip: 'Skip', sending: 'Sending…', starting: 'Starting the camera…',
    loading: 'Getting ready…', hold: 'Prop your phone up somewhere',
    body: 'body', face: 'face', handL: 'left hand', handR: 'right hand',
    noFace: 'Your face was not clearly visible. Expression carries meaning in ISL — move back a little.',
    noHands: 'No hands were seen. Please try again.',
    tooShort: 'Too short. Finish the sign, then stop.',
    stalled: 'Camera tracking stopped. Please reload the page.',
  },
} as const

export default function Recorder({ phrase, lang, busy, onSubmit, onSkip }: Props) {
  const t = T[lang]

  const videoRef = useRef<HTMLVideoElement>(null)
  const replayRef = useRef<HTMLVideoElement>(null)
  const landmarkerRef = useRef<HolisticLandmarker | null>(null)
  const surfaceRef = useRef(new DetectionSurface())
  const rafRef = useRef(0)

  const modeRef = useRef<Mode>('boot')
  const startedAtRef = useRef(0)
  const framesRef = useRef<SignFrame[]>([])
  const seenRef = useRef({ body: 0, face: 0, handL: 0, handR: 0, n: 0 })
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<BlobPart[]>([])
  const mimeRef = useRef(pickVideoMime())
  const liveAtRef = useRef(0)
  const failRef = useRef(0)
  const stalledRef = useRef(false)

  const [mode, setMode] = useState<Mode>('boot')
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [live, setLive] = useState({ body: false, face: false, handL: false, handR: false })
  const [countdown, setCountdown] = useState(3)
  const [elapsed, setElapsed] = useState(0)
  const [take, setTake] = useState<Take | null>(null)
  const [replayUrl, setReplayUrl] = useState('')
  const [stalled, setStalled] = useState(false)

  const setModeBoth = useCallback((m: Mode) => {
    modeRef.current = m
    setMode(m)
  }, [])

  // ---- the per-frame loop -------------------------------------------------
  //
  // Detection is best-effort; the state machine below it is not. A phone
  // that loses its WebGL context — the browser was backgrounded, a call came
  // in, the OS reclaimed memory — makes every detect throw, and if the
  // countdown and the stop timer hung off a successful frame the recorder
  // would freeze on screen with no way out. So the clock drives the states
  // and a failed frame only costs us that frame.
  const tick = useCallback(() => {
    rafRef.current = requestAnimationFrame(tick)
    const v = videoRef.current
    const lm = landmarkerRef.current
    const now = performance.now()

    let ex: ReturnType<typeof extractFrame> = null
    if (v && lm && v.readyState >= 2) {
      const image = surfaceRef.current.update(v)
      if (image) {
        try {
          ex = extractFrame(
            lm.detectForVideo(image, now), now, v.videoWidth / v.videoHeight,
            DEFAULT_BASELINE,
          )
          failRef.current = 0
          if (stalledRef.current) {
            stalledRef.current = false
            setStalled(false)
          }
        } catch {
          failRef.current++
          if (failRef.current > FAIL_LIMIT && !stalledRef.current) {
            stalledRef.current = true
            setStalled(true)
          }
        }
      }
    }

    // The tracking dots are guidance, not data. Repainting them every frame
    // would re-render React 30 times a second on a phone that is already
    // busy running a neural net.
    if (now - liveAtRef.current > 200) {
      liveAtRef.current = now
      setLive({
        body: !!ex, face: !!ex?.sawFace, handL: !!ex?.sawHandL, handR: !!ex?.sawHandR,
      })
    }

    if (modeRef.current === 'countdown') {
      const left = COUNTDOWN_MS - (now - startedAtRef.current)
      setCountdown(Math.max(1, Math.ceil(left / 1000)))
      if (left <= 0) beginRecording(now)
      return
    }

    if (modeRef.current === 'recording') {
      const at = now - startedAtRef.current
      if (ex) {
        framesRef.current.push({ ...ex.frame, t: Math.round(at) })
        const s = seenRef.current
        s.n++
        if (ex.sawBody) s.body++
        if (ex.sawFace) s.face++
        if (ex.sawHandL) s.handL++
        if (ex.sawHandR) s.handR++
      }
      setElapsed(at)
      if (at >= MAX_RECORD_MS) stop()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---- camera + model -----------------------------------------------------
  useEffect(() => {
    let cancelled = false
    let stream: MediaStream | null = null

    ;(async () => {
      try {
        setStatus(t.starting)
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
          audio: false,
        })
        if (cancelled) return
        const v = videoRef.current
        if (v) {
          v.srcObject = stream
          await v.play()
        }
        setStatus(t.loading)
        const { landmarker } = await createLandmarker()
        if (cancelled) {
          landmarker.close()
          return
        }
        landmarkerRef.current = landmarker
        setStatus('')
        setModeBoth('ready')
        rafRef.current = requestAnimationFrame(tick)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    })()

    return () => {
      cancelled = true
      cancelAnimationFrame(rafRef.current)
      landmarkerRef.current?.close()
      landmarkerRef.current = null
      stream?.getTracks().forEach((track) => track.stop())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // A new phrase means the previous take is gone; release its blob URL so a
  // long session does not leak a few megabytes per recording.
  useEffect(() => {
    setTake(null)
    setElapsed(0)
    if (modeRef.current === 'review') setModeBoth('ready')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phrase.id])

  useEffect(() => {
    if (!take?.video) {
      setReplayUrl('')
      return
    }
    const url = URL.createObjectURL(take.video)
    setReplayUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [take])

  const beginRecording = (now: number) => {
    framesRef.current = []
    seenRef.current = { body: 0, face: 0, handL: 0, handR: 0, n: 0 }
    startedAtRef.current = now
    setElapsed(0)
    setModeBoth('recording')

    const stream = videoRef.current?.srcObject as MediaStream | null
    const mime = mimeRef.current
    if (stream && mime) {
      try {
        const rec = new MediaRecorder(stream, { mimeType: mime.record })
        chunksRef.current = []
        rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
        rec.start()
        recorderRef.current = rec
      } catch {
        // Keypoints are the training data and they are already being
        // collected. A phone that cannot record video can still contribute.
        recorderRef.current = null
      }
    }
  }

  const finish = useCallback(() => {
    const frames = trim(framesRef.current)
    const s = seenRef.current
    const n = Math.max(1, s.n)
    const durationMs = frames.length > 0 ? frames[frames.length - 1].t : 0
    const fps = durationMs > 0 ? Math.round((frames.length / durationMs) * 1000) : 0
    const mime = mimeRef.current?.store ?? ''

    const done = (video: Blob | null) => {
      setTake({
        frames, durationMs, fps, video, videoMime: video ? mime : '',
        coverage: {
          body: s.body / n, face: s.face / n, handL: s.handL / n, handR: s.handR / n,
        },
      })
      setModeBoth('review')
    }

    const rec = recorderRef.current
    if (rec && rec.state !== 'inactive') {
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mime })
        chunksRef.current = []
        recorderRef.current = null
        done(blob.size > 0 ? blob : null)
      }
      rec.stop()
    } else {
      done(null)
    }
  }, [setModeBoth])

  const start = () => {
    if (mode !== 'ready' || busy) return
    startedAtRef.current = performance.now()
    setCountdown(3)
    setModeBoth('countdown')
  }

  const stop = useCallback(() => {
    if (modeRef.current === 'countdown') {
      setModeBoth('ready')
      return
    }
    if (modeRef.current !== 'recording') return
    setModeBoth('ready')
    finish()
  }, [finish, setModeBoth])

  const redo = () => {
    setTake(null)
    setModeBoth('ready')
  }

  // ---- what the review screen has to say about the take -------------------
  const problem = take && (
    take.frames.length < 5 || (take.coverage.handL === 0 && take.coverage.handR === 0)
      ? t.noHands
      : take.durationMs < MIN_RECORD_MS ? t.tooShort : ''
  )
  const warning = take && !problem && take.coverage.face < FACE_MIN ? t.noFace : ''

  if (error) {
    return (
      <div className="pane error-pane">
        <p className="err">{error}</p>
        <p className="muted">
          {lang === 'hi'
            ? 'कैमरे की अनुमति दें और पेज दोबारा खोलें।'
            : 'Allow camera access, then reload the page.'}
        </p>
      </div>
    )
  }

  return (
    <div className="recorder">
      <div className="phrase-card">
        <div className="phrase-hi" lang="hi">{phrase.hi}</div>
        <div className="phrase-en">{phrase.en}</div>
        {phrase.face && <div className="phrase-face">☺ {phrase.face}</div>}
      </div>

      <div className="stage">
        <video
          ref={videoRef}
          className={`cam ${mode === 'review' ? 'hidden' : ''}`}
          playsInline muted autoPlay
        />
        {mode === 'review' && replayUrl && (
          <video ref={replayRef} className="cam" src={replayUrl} playsInline muted autoPlay loop />
        )}
        {mode === 'review' && !replayUrl && (
          <div className="no-replay">{take?.frames.length ?? 0} frames</div>
        )}

        {status && <div className="stage-status">{status}</div>}
        {mode === 'countdown' && <div className="countdown">{countdown}</div>}
        {mode === 'recording' && (
          <>
            <div className="rec-badge">● {(elapsed / 1000).toFixed(1)}s</div>
            <div className="rec-bar" style={{ width: `${Math.min(100, (elapsed / MAX_RECORD_MS) * 100)}%` }} />
          </>
        )}
      </div>

      {mode !== 'review' && (
        <div className="tracking">
          <Dot on={live.body} label={t.body} />
          <Dot on={live.face} label={t.face} />
          <Dot on={live.handL} label={t.handL} />
          <Dot on={live.handR} label={t.handR} />
        </div>
      )}

      {mode === 'review' && take && (
        <div className={`verdict ${problem ? 'bad' : warning ? 'warn' : 'good'}`}>
          {problem || warning || (
            lang === 'hi'
              ? `${(take.durationMs / 1000).toFixed(1)} सेकंड · ${take.frames.length} फ़्रेम`
              : `${(take.durationMs / 1000).toFixed(1)}s · ${take.frames.length} frames`
          )}
        </div>
      )}

      <div className="controls">
        {mode === 'review' ? (
          <>
            <button className="btn ghost" onClick={redo} disabled={busy}>{t.again}</button>
            <button
              className="btn primary"
              disabled={busy || !!problem || !take}
              onClick={() => take && onSubmit(take)}
            >
              {busy ? t.sending : t.submit}
            </button>
          </>
        ) : mode === 'recording' || mode === 'countdown' ? (
          <button className="btn stop" onClick={stop}>{t.stop}</button>
        ) : (
          <>
            <button className="btn ghost" onClick={onSkip} disabled={busy}>{t.skip}</button>
            <button className="btn primary" onClick={start} disabled={mode !== 'ready' || busy}>
              {t.record}
            </button>
          </>
        )}
      </div>

      {stalled && <p className="hint stalled">{t.stalled}</p>}
      {mode === 'ready' && !stalled && <p className="hint">{t.hold}</p>}
    </div>
  )
}

function Dot({ on, label }: { on: boolean; label: string }) {
  return <span className={`dot ${on ? 'on' : 'off'}`}>{label}</span>
}

/**
 * Drop the dead air at both ends — mirrors the studio's trim so that a clip
 * recorded on a phone and one recorded in the studio are cut the same way.
 * A take begins and ends with the signer's hands at rest, and those frames
 * teach a model to pause rather than to sign.
 */
function trim(frames: SignFrame[]): SignFrame[] {
  const active = (f: SignFrame) => f.handL !== null || f.handR !== null
  let a = frames.findIndex(active)
  let b = frames.length - 1
  while (b > 0 && !active(frames[b])) b--
  if (a < 0) return frames // hands never seen — let the reviewer decide
  a = Math.max(0, a - 2)   // two frames of run-up keeps the entry natural
  b = Math.min(frames.length - 1, b + 2)
  const t0 = frames[a].t
  return frames.slice(a, b + 1).map((f) => ({ ...f, t: f.t - t0 }))
}
