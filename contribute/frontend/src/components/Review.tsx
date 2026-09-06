// The review queue.
//
// Two reviewers agreeing settles a clip. The screen is built around one
// decision at a time because that is how the work actually happens — an NGO
// partner with ten spare minutes on a phone, not an annotation console.
//
// What is played back is the *pose*, not the video. The keypoints are what
// gets trained on, and a video can look perfectly fine while the tracking
// underneath it lost a hand for half the clip. The video is there too, when
// R2 has it, for the times the pose looks wrong and you need to know why.

import { useEffect, useRef, useState } from 'react'
import type { SignClip } from '@sign/poseFormat'
import { SignPlayer } from '@sign/player'
import { getReviewQueue, postReview } from '../lib/api'
import type { ReviewClip } from '../lib/api'
import type { Lang } from '../lib/device'

const REASON_LABELS: Record<string, { hi: string; en: string }> = {
  'wrong-sign': { hi: 'गलत साइन', en: 'Wrong sign' },
  unclear: { hi: 'साफ़ नहीं', en: 'Unclear' },
  'face-not-visible': { hi: 'चेहरा नहीं दिखा', en: 'Face not visible' },
  other: { hi: 'कुछ और', en: 'Something else' },
}

const T = {
  hi: {
    title: 'जाँच', empty: 'अभी कुछ जाँचने को नहीं है।', loading: 'लोड हो रहा है…',
    approve: 'सही है', reject: 'गलत है', variant: 'अलग इलाक़े का साइन',
    variantHint: 'यह गलत नहीं — बस अलग तरीक़ा। ऐसे साइन भी डेटा में रहते हैं।',
    variantPlaceholder: 'जैसे: गुजरात', save: 'भेजें', cancel: 'रहने दें',
    why: 'क्यों?', pose: 'पोज़', video: 'वीडियो', noVideo: 'वीडियो नहीं है',
    by: 'रिकॉर्ड किया', left: 'बाक़ी', approvals: 'मंज़ूरी',
    refresh: 'फिर देखें', reviewed: 'जाँचे',
    body: 'शरीर', faceCov: 'चेहरा', hands: 'हाथ',
  },
  en: {
    title: 'Review', empty: 'Nothing to review right now.', loading: 'Loading…',
    approve: 'Correct', reject: 'Not correct', variant: 'Regional variant',
    variantHint: 'Not wrong — just signed differently. Variants stay in the dataset.',
    variantPlaceholder: 'e.g. Gujarat', save: 'Send', cancel: 'Cancel',
    why: 'Why?', pose: 'Pose', video: 'Video', noVideo: 'No video',
    by: 'recorded by', left: 'left', approvals: 'approvals',
    refresh: 'Check again', reviewed: 'reviewed',
    body: 'body', faceCov: 'face', hands: 'hands',
  },
} as const

interface Props {
  lang: Lang
  onLeave: () => void
}

export default function Review({ lang, onLeave }: Props) {
  const t = T[lang]
  const [clips, setClips] = useState<ReviewClip[]>([])
  const [needed, setNeeded] = useState(2)
  const [reasons, setReasons] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [rejecting, setRejecting] = useState(false)
  const [variantTag, setVariantTag] = useState('')
  const [showVariant, setShowVariant] = useState(false)
  const [tab, setTab] = useState<'pose' | 'video'>('pose')
  const [done, setDone] = useState(0)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const playerRef = useRef<SignPlayer | null>(null)
  const clip = clips[0]

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const q = await getReviewQueue()
      setClips(q.clips)
      setNeeded(q.needed)
      setReasons(q.reasons)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  // One player for the whole session, reloaded per clip — building a new one
  // per clip would leak a requestAnimationFrame loop each time.
  useEffect(() => {
    if (!canvasRef.current) return
    playerRef.current ??= new SignPlayer(canvasRef.current, {
      loop: true, trail: 10, fit: 0.9,
    })
    return () => {
      playerRef.current?.destroy()
      playerRef.current = null
    }
  }, [])

  useEffect(() => {
    setRejecting(false)
    setShowVariant(false)
    setVariantTag('')
    setTab('pose')
    const player = playerRef.current
    if (!player) return
    if (!clip) {
      player.load(null)
      return
    }
    player.load(asClip(clip))
    player.play()
  }, [clip])

  const send = async (verdict: 'approve' | 'reject', reason = '') => {
    if (!clip || busy) return
    setBusy(true)
    setError('')
    try {
      await postReview(clip.id, {
        verdict, reason,
        ...(variantTag.trim() ? { variant_tag: variantTag.trim() } : {}),
      })
      setDone((n) => n + 1)
      setClips((prev) => {
        const next = prev.slice(1)
        if (next.length === 0) load()
        return next
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (loading && clips.length === 0) {
    return <div className="pane"><p className="muted">{t.loading}</p></div>
  }

  if (!clip) {
    return (
      <div className="pane waiting">
        <div className="waiting-mark">✓</div>
        <h1>{t.empty}</h1>
        {done > 0 && <p className="muted">{done} {t.reviewed}</p>}
        <div className="controls">
          <button className="btn ghost" onClick={onLeave}>←</button>
          <button className="btn primary" onClick={load}>{t.refresh}</button>
        </div>
      </div>
    )
  }

  return (
    <div className="review">
      <div className="review-head">
        <button className="link" onClick={onLeave}>←</button>
        <span className="muted small">
          {clips.length} {t.left} · {clip.approvals}/{needed} {t.approvals}
        </span>
      </div>

      <div className="phrase-card">
        <div className="phrase-hi" lang="hi">{clip.hi}</div>
        <div className="phrase-en">{clip.en} · <span className="gloss">{clip.gloss}</span></div>
        {clip.face_prompt && <div className="phrase-face">☺ {clip.face_prompt}</div>}
      </div>

      <div className="tabs">
        <button className={tab === 'pose' ? 'on' : ''} onClick={() => setTab('pose')}>
          {t.pose}
        </button>
        <button className={tab === 'video' ? 'on' : ''}
                onClick={() => setTab('video')} disabled={!clip.video_url}>
          {clip.video_url ? t.video : t.noVideo}
        </button>
      </div>

      <div className="review-stage">
        <canvas ref={canvasRef} className={tab === 'pose' ? '' : 'hidden'} />
        {tab === 'video' && clip.video_url && (
          <video src={clip.video_url} className="cam" playsInline muted autoPlay loop controls />
        )}
      </div>

      <div className="cov">
        <Cov label={t.body} v={clip.cov_body} />
        <Cov label={t.faceCov} v={clip.cov_face} />
        <Cov label={t.hands} v={Math.max(clip.cov_hand_l, clip.cov_hand_r)} />
        <span className="muted small">
          {(clip.duration_ms / 1000).toFixed(1)}s · {clip.frame_count}f
          {clip.contributor_name ? ` · ${t.by} ${clip.contributor_name}` : ''}
        </span>
      </div>

      {error && <p className="err small">{error}</p>}

      {showVariant && (
        <div className="variant-box">
          <p className="small">{t.variantHint}</p>
          <input value={variantTag} onChange={(e) => setVariantTag(e.target.value)}
                 placeholder={t.variantPlaceholder} maxLength={60} />
        </div>
      )}

      {rejecting ? (
        <div className="reasons">
          <p className="small muted">{t.why}</p>
          {reasons.map((r) => (
            <button key={r} className="btn ghost" disabled={busy}
                    onClick={() => send('reject', r)}>
              {REASON_LABELS[r]?.[lang] ?? r}
            </button>
          ))}
          <button className="link" onClick={() => setRejecting(false)}>{t.cancel}</button>
        </div>
      ) : (
        <>
          <button className="link variant-toggle"
                  onClick={() => setShowVariant((v) => !v)}>
            {showVariant ? t.cancel : `⚑ ${t.variant}`}
          </button>
          <div className="controls">
            <button className="btn ghost" disabled={busy}
                    onClick={() => setRejecting(true)}>{t.reject}</button>
            <button className="btn primary" disabled={busy}
                    onClick={() => send('approve')}>{t.approve}</button>
          </div>
        </>
      )}
    </div>
  )
}

function Cov({ label, v }: { label: string; v: number }) {
  const pct = Math.round(v * 100)
  return (
    <span className={`cov-chip ${pct >= 80 ? 'ok' : pct >= 50 ? 'mid' : 'low'}`}>
      {label} {pct}%
    </span>
  )
}

/**
 * The player draws a SignClip; the queue sends the frames plus the phrase.
 * Only the fields the renderer reads are filled — a reviewer's screen has no
 * business inventing a consent record to satisfy a type.
 */
function asClip(c: ReviewClip): SignClip {
  return {
    id: c.id,
    format: 2,
    phraseId: c.phrase_id,
    text: { hi: c.hi, en: c.en },
    gloss: c.gloss,
    kind: c.kind,
    signer: {
      signerId: '', displayName: '', consentedAt: '',
      scope: 'research-and-product', note: '',
    },
    fps: c.fps,
    durationMs: c.duration_ms,
    frames: c.frames,
    notes: '',
    quality: 'unsure',
    createdAt: '',
  }
}
