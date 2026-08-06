import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { audioUrl, authFetch } from '../lib/auth'
import { fmtDuration, fmtRelative, resolveDisplay, type NamedContact } from '../lib/format'
import Avatar from '../components/Avatar'
import { PhoneIcon } from '../components/icons'
import { peerNumber } from './CallPage'

interface TimelineEvent {
  t_ms: number
  event: string
  [key: string]: string | number | boolean | undefined
}

export interface CallRecord {
  id: number
  call_uuid: string
  from_number: string
  to_number?: string
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
  const navigate = useNavigate()
  const [calls, setCalls] = useState<CallRecord[]>([])
  const [contacts, setContacts] = useState<NamedContact[]>([])
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    authFetch('/api/contacts')
      .then((r) => r.json())
      .then((d) => setContacts(d.contacts ?? []))
      .catch(() => {})
    authFetch('/api/calls')
      .then((r) => r.json())
      .then((d) => setCalls(d.calls ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  return (
    <main className="history-page">
      <section className="history">
        {loading && (
          <>
            {[0, 1, 2, 3].map((i) => (
              <div className="recent-row" key={i}>
                <div className="avatar tiny skeleton" />
                <div className="recent-main">
                  <div className="skeleton skeleton-line w60" />
                  <div className="skeleton skeleton-line w40" />
                </div>
              </div>
            ))}
          </>
        )}
        {!loading && calls.length === 0 && (
          <p className="idle-hint">No calls yet. When calls come in, they will appear here with full transcripts.</p>
        )}
        {calls.map((c) => {
          const display = resolveDisplay(c.from_number, contacts)
          const missed = !c.answered
          const out = c.direction === 'out'
          const num = peerNumber(c)
          return (
            <div key={c.id} className="history-item">
              <div className="history-head">
                <button
                  className="history-row"
                  onClick={() => setExpandedId(expandedId === c.id ? null : c.id)}
                >
                  <Avatar name={display} variant="tiny" />
                  <div className="recent-main">
                    <b className={missed ? 'missed-text' : ''}>{display}</b>
                    <small>
                      <span className={`dir ${missed ? 'red' : out ? 'orange' : 'green'}`}>
                        {out ? '↗' : missed ? '↓' : '↙'}
                      </span>{' '}
                      {missed ? (c.reason === 'declined' ? 'Declined' : 'Missed') : fmtDuration(c.duration_s)}
                      {' · '}
                      {fmtRelative(c.started_at)}
                    </small>
                  </div>
                  <span className="history-chevron">{expandedId === c.id ? '▲' : '▼'}</span>
                </button>
                {num && (
                  <button
                    className="row-call"
                    aria-label={`Call ${display}`}
                    onClick={() => navigate('/call', { state: { dial: { number: num, name: display } } })}
                  >
                    <PhoneIcon size={18} strokeWidth={2.2} />
                  </button>
                )}
              </div>
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
                        <small>Caller audio</small>
                        <audio controls preload="none" src={audioUrl(`/api/calls/${c.call_uuid}/audio/caller`)} />
                      </div>
                      <div className="audio-track">
                        <small>Your audio</small>
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
          )
        })}
      </section>
    </main>
  )
}
