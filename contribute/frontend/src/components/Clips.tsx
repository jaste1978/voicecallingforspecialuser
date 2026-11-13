// The archive. Every clip that has been recorded, with the video.
//
// Review shows one clip at a time and hides your own and anything you have
// already voted on — right for reviewing, useless for knowing what you have.
// This screen is the other half: the whole collection, filterable, with the
// pose and the video side by side and a way to settle a clip by hand when
// peer review has deadlocked.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { SignClip } from '@sign/poseFormat'
import { SignPlayer } from '@sign/player'
import { adminClip, adminClips, setClipReview } from '../lib/api'
import type { AdminClip, AdminClipDetail } from '../lib/api'

const TABS: { key: string; label: string }[] = [
  { key: 'pending', label: 'Waiting' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
  { key: '', label: 'All' },
]

const VIA: Record<string, string> = {
  'trusted-contributor': 'trusted signer',
  'admin-override': 'admin decided',
  'peer-review': 'peer review',
}

interface Props {
  onLeave: () => void
}

export default function Clips({ onLeave }: Props) {
  const [tab, setTab] = useState('')
  const [page, setPage] = useState<AdminClip[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [total, setTotal] = useState(0)
  const [needed, setNeeded] = useState(2)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [openId, setOpenId] = useState('')
  const [detail, setDetail] = useState<AdminClipDetail | null>(null)
  const [acting, setActing] = useState(false)

  const load = useCallback(async (status: string) => {
    setLoading(true)
    setError('')
    try {
      const r = await adminClips({ review_status: status, limit: 200 })
      setPage(r.clips)
      setCounts(r.counts)
      setTotal(r.total)
      setNeeded(r.needed)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load(tab) }, [tab, load])

  // Opening a clip is a second call: the list carries no keypoints, because
  // 14KB of pose per clip would make it megabytes long.
  useEffect(() => {
    if (!openId) { setDetail(null); return }
    let live = true
    setDetail(null)
    adminClip(openId)
      .then((d) => { if (live) setDetail(d) })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
    return () => { live = false }
  }, [openId])

  const settle = async (id: string, status: 'approved' | 'rejected' | 'pending') => {
    setActing(true)
    setError('')
    try {
      await setClipReview(id, status)
      await load(tab)
      if (openId === id) setDetail(await adminClip(id))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setActing(false)
    }
  }

  const bytes = page.reduce((n, c) => n + (c.video_bytes || 0), 0)

  return (
    <div className="pane admin clips">
      <div className="admin-head">
        <h1>Clips</h1>
        <button className="link" onClick={onLeave}>← back</button>
      </div>

      <div className="tabs">
        {TABS.map((f) => (
          <button key={f.key} className={tab === f.key ? 'on' : ''}
                  onClick={() => { setOpenId(''); setTab(f.key) }}>
            {f.label}
            {f.key ? ` · ${counts[f.key] ?? 0}`
                   : ` · ${Object.values(counts).reduce((a, b) => a + b, 0)}`}
          </button>
        ))}
      </div>

      <p className="muted small">
        {total} clip{total === 1 ? '' : 's'}
        {bytes > 0 && ` · ${(bytes / 1048576).toFixed(1)} MB of video`}
        {' · '}
        <a href="/api/admin/export.jsonl?review_status=approved" download>
          download approved (.jsonl)
        </a>
        {' · '}
        <a href="/api/admin/export.jsonl" download>everything</a>
      </p>

      {error && <p className="err">{error}</p>}
      {loading && <p className="muted">Loading…</p>}
      {!loading && page.length === 0 && <p className="muted">No clips here.</p>}

      <ul className="cliplist">
        {page.map((c) => (
          <li key={c.id} className={`clip ${c.review_status} ${openId === c.id ? 'open' : ''}`}>
            <button className="clip-row" onClick={() => setOpenId(openId === c.id ? '' : c.id)}>
              <span className="clip-phrase">
                <span lang="hi">{c.hi}</span>
                <span className="muted small"> {c.en} · {c.gloss}</span>
              </span>
              <span className="clip-meta">
                <span className={`pill ${c.review_status}`}>{c.review_status}</span>
                {c.approved_via && <span className="pill via">{VIA[c.approved_via] ?? c.approved_via}</span>}
                {c.review_status === 'pending' && (
                  <span className="muted small">{c.approvals}/{needed}</span>
                )}
                {c.variant_tag && <span className="pill role">⚑ {c.variant_tag}</span>}
                {!c.video_url && <span className="pill low">no video</span>}
              </span>
              <span className="clip-who muted small">
                {c.contributor_name || 'unknown'} · {when(c.created_at)} ·{' '}
                {(c.duration_ms / 1000).toFixed(1)}s
              </span>
            </button>

            {openId === c.id && (
              <Detail clip={c} detail={detail} acting={acting}
                      needed={needed} onSettle={settle} />
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

function Detail({ clip, detail, acting, needed, onSettle }: {
  clip: AdminClip
  detail: AdminClipDetail | null
  acting: boolean
  needed: number
  onSettle: (id: string, status: 'approved' | 'rejected' | 'pending') => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const playerRef = useRef<SignPlayer | null>(null)

  // One player, torn down with the panel. Building one per render would leak
  // a requestAnimationFrame loop every time the pose reloaded.
  useEffect(() => {
    if (!canvasRef.current || !detail) return
    playerRef.current ??= new SignPlayer(canvasRef.current, {
      loop: true, trail: 10, fit: 0.9,
    })
    playerRef.current.load(asClip(detail))
    playerRef.current.play()
    return () => {
      playerRef.current?.destroy()
      playerRef.current = null
    }
  }, [detail])

  return (
    <div className="clip-detail">
      <div className="clip-stage">
        {clip.video_url
          ? <video src={clip.video_url} className="cam" playsInline muted autoPlay loop controls />
          : <p className="muted small">No video stored for this clip.</p>}
        <canvas ref={canvasRef} />
      </div>

      <div className="cov">
        <Cov label="body" v={clip.cov_body} />
        <Cov label="face" v={clip.cov_face} />
        <Cov label="hands" v={Math.max(clip.cov_hand_l, clip.cov_hand_r)} />
        <span className="muted small">
          {clip.frame_count}f @ {clip.fps.toFixed(0)}fps · {(clip.keypoints_bytes / 1024).toFixed(0)}KB pose
        </span>
      </div>

      {detail === null
        ? <p className="muted small">Loading pose…</p>
        : detail.reviews.length > 0 && (
          <ul className="votes">
            {detail.reviews.map((v, i) => (
              <li key={i} className="muted small">
                {v.verdict === 'approve' ? '✓' : '✕'} {v.reviewer_name || 'someone'}
                {v.reason ? ` · ${v.reason}` : ''} · {when(v.created_at)}
              </li>
            ))}
          </ul>
        )}

      <div className="user-acts">
        {clip.review_status !== 'approved' && (
          <button className="btn small primary" disabled={acting}
                  onClick={() => onSettle(clip.id, 'approved')}>
            Approve {clip.review_status === 'pending' && clip.approvals < needed ? '(override)' : ''}
          </button>
        )}
        {clip.review_status !== 'rejected' && (
          <button className="btn small ghost" disabled={acting}
                  onClick={() => onSettle(clip.id, 'rejected')}>Reject</button>
        )}
        {clip.review_status !== 'pending' && (
          <button className="btn small ghost" disabled={acting}
                  onClick={() => onSettle(clip.id, 'pending')}>Back to review</button>
        )}
      </div>
      <p className="muted small">{clip.id} · {clip.phrase_id}</p>
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

function asClip(c: AdminClipDetail): SignClip {
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

function when(seconds: number | null): string {
  if (!seconds) return '—'
  const mins = Math.floor((Date.now() / 1000 - seconds) / 60)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return days < 30 ? `${days}d ago` : new Date(seconds * 1000).toLocaleDateString()
}
