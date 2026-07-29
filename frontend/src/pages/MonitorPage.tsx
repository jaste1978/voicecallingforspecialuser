import { useEffect, useState } from 'react'
import { authFetch } from '../lib/auth'

interface Stage {
  stage: string
  ok: boolean
  at_ms: number | null
  note: string
  target_ms: number | null
}

interface CallReport {
  id: number
  from_number: string
  direction: string
  started_at: number
  duration_s: number
  answered: boolean
  reason: string
  verdict: 'ok' | 'degraded' | 'failed'
  verdict_note: string
  captions: number
  caption_latency_median_ms: number | null
  quality_score: number | null
  stages: Stage[]
}

function qualityClass(score: number): string {
  if (score >= 75) return 'verdict-ok'
  if (score >= 50) return 'verdict-warn'
  return 'verdict-bad'
}

interface MonitorData {
  live: { screens_connected: number; call_state: string; call_from: string | null }
  calls: CallReport[]
}

const STAGE_LABELS: Record<string, string> = {
  received: 'Received',
  media: 'Audio up',
  ring_sent: 'Ring sent',
  ring_shown: 'Ring shown',
  answered: 'Answered',
  stt: 'Captions ready',
  first_caption: 'First caption',
  romanized_rescue: 'Rescue mode',
  ended: 'Ended',
}

const VERDICT_STYLE: Record<string, string> = {
  ok: 'verdict-ok',
  degraded: 'verdict-warn',
  failed: 'verdict-bad',
}

function fmtWhen(ts: number): string {
  return new Date(ts * 1000).toLocaleString([], {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}

export default function MonitorPage() {
  const [data, setData] = useState<MonitorData | null>(null)
  const [expanded, setExpanded] = useState<number | null>(null)

  useEffect(() => {
    let alive = true
    const load = () =>
      authFetch('/api/monitor')
        .then((r) => r.json())
        .then((d) => alive && setData(d))
        .catch(() => {})
    load()
    const t = setInterval(load, 5000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [])

  if (!data) return <main className="stub">Loading…</main>

  const screens = data.live.screens_connected

  return (
    <main className="settings-page">
      <section className={`setting-block live-card ${screens > 0 ? '' : 'live-bad'}`}>
        <h3>{screens > 0 ? '🟢 Ready to receive calls' : '🔴 NOT ready — no app connected'}</h3>
        <p className="idle-hint">
          {screens} screen{screens === 1 ? '' : 's'} connected to the call server
          {screens === 0 && ' — incoming calls cannot ring anywhere. Open the Calls page.'}
        </p>
        <p className="idle-hint">
          Current call: {data.live.call_state === 'none' ? 'none' : `${data.live.call_state} (${data.live.call_from})`}
        </p>
      </section>

      <h3 className="monitor-heading">Last {data.calls.length} calls</h3>
      {data.calls.map((c) => (
        <section className="setting-block" key={c.id}>
          <button
            className="monitor-row"
            onClick={() => setExpanded(expanded === c.id ? null : c.id)}
          >
            <span className={`verdict-dot ${VERDICT_STYLE[c.verdict]}`} />
            <span className="monitor-main">
              <strong>
                {c.direction === 'out' ? '↗' : '↙'} {c.from_number}
              </strong>
              <small>
                {fmtWhen(c.started_at)} · {c.duration_s}s · {c.captions} captions
                {c.caption_latency_median_ms != null && ` · ${c.caption_latency_median_ms}ms median`}
                {c.quality_score != null && (
                  <>
                    {' · '}
                    <span className={`quality-chip ${qualityClass(c.quality_score)}`}>
                      {c.quality_score}% accurate
                    </span>
                  </>
                )}
              </small>
            </span>
            <span className="monitor-verdict">
              {c.verdict === 'ok' ? c.reason || 'ok' : c.verdict_note}
            </span>
          </button>
          {expanded === c.id && (
            <div className="funnel">
              {c.stages.map((s) => (
                <div className="funnel-row" key={s.stage}>
                  <span className={s.ok ? 'funnel-ok' : 'funnel-bad'}>
                    {s.ok ? '✓' : '✗'}
                  </span>
                  <span className="funnel-name">{STAGE_LABELS[s.stage] ?? s.stage}</span>
                  <span className="funnel-time">
                    {s.at_ms != null ? `+${(s.at_ms / 1000).toFixed(2)}s` : '—'}
                  </span>
                  <span className="funnel-note">{s.note}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      ))}
    </main>
  )
}
