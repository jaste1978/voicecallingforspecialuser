import { useEffect, useState } from 'react'
import { audioUrl, authFetch } from '../lib/auth'

interface TimelineEvent {
  t_ms: number
  event: string
  [key: string]: string | number | boolean | undefined
}

export interface CallRecord {
  id: number
  call_uuid: string
  from_number: string
  started_at: number
  answered: boolean
  duration_s: number
  reason: string
  direction?: string
  transcript: string[]
  timeline: TimelineEvent[]
  quality_score: number | null
  batch_transcript: string | null
}

export function formatWhen(ts: number): string {
  return new Date(ts * 1000).toLocaleString([], {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}

export function formatDuration(s: number): string {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function formatOffset(ms: number): string {
  return `+${(ms / 1000).toFixed(2)}s`
}

function eventDetail(e: TimelineEvent): string {
  return Object.entries(e)
    .filter(([k]) => k !== 't_ms' && k !== 'event')
    .map(([k, v]) => `${k}=${v}`)
    .join('  ')
}

export default function HistoryPage() {
  const [calls, setCalls] = useState<CallRecord[]>([])
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    authFetch('/api/calls')
      .then((r) => r.json())
      .then((d) => setCalls(d.calls ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  return (
    <main className="history-page">
      <section className="history">
        {loading && <p className="idle-hint">Loading…</p>}
        {!loading && calls.length === 0 && (
          <p className="idle-hint">No calls yet. When calls come in, they will appear here with full transcripts.</p>
        )}
        {calls.map((c) => (
          <div key={c.id} className="history-item">
            <button
              className="history-row"
              onClick={() => setExpandedId(expandedId === c.id ? null : c.id)}
            >
              <span className={`history-badge${c.answered ? '' : ' missed'}`}>
                {c.answered ? '✓' : '✕'}
              </span>
              <span className="history-number">
                {c.direction === 'out' ? '↗ ' : '↙ '}
                {c.from_number}
              </span>
              <span className="history-meta">
                {formatWhen(c.started_at)}
                {c.answered ? ` · ${formatDuration(c.duration_s)}` : ` · ${c.reason}`}
              </span>
              <span className="history-chevron">{expandedId === c.id ? '▲' : '▼'}</span>
            </button>
            {expandedId === c.id && (
              <div className="history-transcript">
                {c.quality_score != null && (
                  <p className="quality-line">
                    Caption accuracy:{' '}
                    <strong
                      className={
                        c.quality_score >= 75
                          ? 'q-ok'
                          : c.quality_score >= 50
                            ? 'q-warn'
                            : 'q-bad'
                      }
                    >
                      {c.quality_score}%
                    </strong>{' '}
                    <small>(live captions vs full-context AI re-check)</small>
                  </p>
                )}
                {c.transcript.length === 0 ? (
                  <p className="idle-hint">No captions for this call.</p>
                ) : (
                  <p className="caption-flow-history">{c.transcript.join(' ')}</p>
                )}
                {c.batch_transcript && (
                  <details className="timeline">
                    <summary>AI reference transcript (full-context re-check)</summary>
                    <p className="caption-flow-history">{c.batch_transcript}</p>
                  </details>
                )}
                {c.answered && (
                  <div className="audio-row">
                    <div className="audio-track">
                      <small>📞 Caller audio</small>
                      <audio controls preload="none" src={audioUrl(`/api/calls/${c.call_uuid}/audio/caller`)} />
                    </div>
                    <div className="audio-track">
                      <small>🎤 Your audio</small>
                      <audio controls preload="none" src={audioUrl(`/api/calls/${c.call_uuid}/audio/user`)} />
                    </div>
                  </div>
                )}
                {c.timeline.length > 0 && (
                  <details className="timeline">
                    <summary>Data timeline ({c.timeline.length} events)</summary>
                    <div className="timeline-events">
                      {c.timeline.map((e, i) => (
                        <div
                          key={i}
                          className={`timeline-row${e.event === 'caption' ? ' caption-ev' : ''}`}
                        >
                          <span className="timeline-t">{formatOffset(e.t_ms)}</span>
                          <span className="timeline-name">{e.event}</span>
                          <span className="timeline-detail">{eventDetail(e)}</span>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            )}
          </div>
        ))}
      </section>
    </main>
  )
}
