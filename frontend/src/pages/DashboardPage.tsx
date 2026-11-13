import { useEffect, useState } from 'react'
import { authFetch } from '../lib/auth'

interface Window {
  calls: number
  answered: number
  missed: number
  users: number
  minutes: number
  avg_quality: number | null
  median_quality: number | null
  spend: number
}

interface Stats {
  generated_at: string
  users: {
    total: number; active: number; pending: number; rejected: number; admins: number
    new_7d: number; new_30d: number; first_signup: string | null
    with_number: number; with_calls: number
  }
  numbers: { kind: string; n: number }[]
  calls: Window & {
    first_call: string | null; last_call: string | null; scored: number
    min_quality: number | null; max_quality: number | null; p25_quality: number | null
    tts_chars: number
  }
  windows: { today: Window; '7d': Window; '30d': Window }
  by_month: { month: string; calls: number; answered: number; avg_quality: number | null; users: number; minutes: number }[]
  by_day: { day: string; calls: number; answered: number; avg_quality: number | null }[]
  languages: { language: string; n: number }[]
  direction: { direction: string; n: number }[]
  miss_reasons: { reason: string; n: number }[]
  top_users: { user_id: number; name: string | null; calls: number; minutes: number; avg_quality: number | null; last: string | null }[]
  sentinel: { runs: number; ok: number; last_run: string | null; last_ok: boolean | null }
  other: Record<string, number>
  contribute: { clips: number; people: number; phrases_covered: number; phrases_total: number } | null
}

// Caption-accuracy figures are hidden for now (too few scored calls to be
// meaningful to an outside reader). Flip to true to show them everywhere.
const SHOW_ACCURACY = false

const LANG: Record<string, string> = {
  'hi-IN': 'Hindi', 'gu-IN': 'Gujarati', 'mr-IN': 'Marathi', 'en-IN': 'English',
  hi: 'Hindi', gu: 'Gujarati', mr: 'Marathi', en: 'English', unknown: 'Not detected',
  auto: 'Auto-detected', romanized: 'Romanised rescue',
}
const OTHER_LABEL: Record<string, string> = {
  contacts: 'Contacts saved', waitlist: 'Waitlist entries', support_messages: 'Support messages',
  call_feedback: 'Call feedback', deletion_requests: 'Deletion requests', telegram_linked: 'Telegram linked',
}

const pct = (v: number | null | undefined) => (v == null ? '—' : `${v}%`)
const n = (v: number | null | undefined) => (v == null ? '—' : v.toLocaleString('en-IN'))
const monthName = (m: string) => {
  const [y, mo] = m.split('-').map(Number)
  return new Date(y, mo - 1, 1).toLocaleString('en-IN', { month: 'short', year: 'numeric' })
}
const rs = (v: number | null | undefined) => (v == null ? '—' : `₹${v.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`)

function Kpi(props: { label: string; value: string; sub?: string; tone?: 'ok' | 'warn' | 'bad' }) {
  return (
    <div className={`kpi${props.tone ? ` kpi-${props.tone}` : ''}`}>
      <b>{props.value}</b>
      <span>{props.label}</span>
      {props.sub && <small>{props.sub}</small>}
    </div>
  )
}

function qualityTone(q: number | null): 'ok' | 'warn' | 'bad' | undefined {
  if (q == null) return undefined
  return q >= 75 ? 'ok' : q >= 50 ? 'warn' : 'bad'
}

export default function DashboardPage() {
  const [data, setData] = useState<Stats | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function load() {
    setBusy(true)
    try {
      const r = await authFetch('/api/stats')
      if (!r.ok) throw new Error(String(r.status))
      setData(await r.json())
      setErr('')
    } catch (e) {
      setErr(`Could not load stats (${(e as Error).message})`)
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => { void load() }, [])

  if (!data) return <main className="stub">{err || 'Loading…'}</main>

  const c = data.calls
  const w = data.windows
  const maxDay = Math.max(1, ...data.by_day.map((d) => d.calls))
  const answerRate = c.calls ? Math.round((c.answered / c.calls) * 100) : null

  return (
    <main className="settings-page dash">
      <p className="dash-asof">
        As of {data.generated_at} IST · real calls only (night-watch excluded)
        <button className="promptbtn dash-refresh" onClick={() => void load()} disabled={busy}>
          {busy ? 'Refreshing…' : 'Refresh'}
        </button>
      </p>

      <h3 className="monitor-heading">All time</h3>
      <div className="kpi-grid">
        <Kpi label="Active users" value={n(data.users.active)} sub={`${n(data.users.pending)} pending · ${n(data.users.with_calls)} have taken a call`} />
        <Kpi label="Calls" value={n(c.calls)} sub={`${n(c.answered)} answered · ${n(c.missed)} missed`} />
        <Kpi label="Talk minutes" value={n(Math.round(c.minutes))} sub={c.first_call ? `since ${c.first_call}` : 'no calls yet'} />
        {SHOW_ACCURACY ? (
          <Kpi label="Caption accuracy" value={pct(c.avg_quality)} tone={qualityTone(c.avg_quality)}
            sub={c.scored ? `median ${pct(c.median_quality)} · range ${pct(c.min_quality)}–${pct(c.max_quality)} · ${n(c.scored)} scored` : 'no scored calls'} />
        ) : (
          <Kpi label="Answer rate" value={answerRate == null ? '—' : `${answerRate}%`} tone={answerRate == null ? undefined : answerRate >= 75 ? 'ok' : answerRate >= 50 ? 'warn' : 'bad'}
            sub={`${n(c.missed)} missed of ${n(c.calls)}`} />
        )}
        <Kpi label="Spend" value={rs(c.spend)} sub={c.minutes ? `≈ ₹${(c.spend / c.minutes).toFixed(2)} per minute` : ''} />
        <Kpi label="ISL clips" value={data.contribute ? n(data.contribute.clips) : '—'}
          sub={data.contribute ? `${n(data.contribute.people)} contributor${data.contribute.people === 1 ? '' : 's'} · ${n(data.contribute.phrases_covered)} of ${n(data.contribute.phrases_total)} phrases` : 'contribute.sunosathi.com unreachable'} />
      </div>

      <h3 className="monitor-heading">Recent windows</h3>
      <section className="setting-block dash-table">
        <table>
          <thead><tr><th></th><th>Today</th><th>7 days</th><th>30 days</th></tr></thead>
          <tbody>
            <tr><td>Calls</td><td>{n(w.today.calls)}</td><td>{n(w['7d'].calls)}</td><td>{n(w['30d'].calls)}</td></tr>
            <tr><td>Answered</td><td>{n(w.today.answered)}</td><td>{n(w['7d'].answered)}</td><td>{n(w['30d'].answered)}</td></tr>
            <tr><td>Users calling</td><td>{n(w.today.users)}</td><td>{n(w['7d'].users)}</td><td>{n(w['30d'].users)}</td></tr>
            <tr><td>Minutes</td><td>{n(w.today.minutes)}</td><td>{n(w['7d'].minutes)}</td><td>{n(w['30d'].minutes)}</td></tr>
            {SHOW_ACCURACY && <tr><td>Accuracy</td><td>{pct(w.today.avg_quality)}</td><td>{pct(w['7d'].avg_quality)}</td><td>{pct(w['30d'].avg_quality)}</td></tr>}
            <tr><td>Spend</td><td>{rs(w.today.spend)}</td><td>{rs(w['7d'].spend)}</td><td>{rs(w['30d'].spend)}</td></tr>
          </tbody>
        </table>
      </section>

      <h3 className="monitor-heading">Last 14 days</h3>
      <section className="setting-block">
        <div className="dash-bars" role="img" aria-label="Calls per day, last 14 days">
          {data.by_day.map((d) => (
            <div className="dash-bar" key={d.day} title={`${d.day}: ${d.calls} calls, ${d.answered} answered${SHOW_ACCURACY && d.avg_quality != null ? `, ${d.avg_quality}% accurate` : ''}`}>
              <i style={{ height: `${(d.calls / maxDay) * 100}%` }}>
                <em style={{ height: d.calls ? `${(d.answered / d.calls) * 100}%` : 0 }} />
              </i>
              <span>{d.calls || ''}</span>
              <small>{d.day.slice(0, 2)}</small>
            </div>
          ))}
        </div>
        <p className="idle-hint" style={{ marginTop: 6 }}>Bar = calls, filled part = answered. Day numbers below.</p>
      </section>

      <h3 className="monitor-heading">By month</h3>
      <section className="setting-block dash-table">
        <table>
          <thead><tr><th>Month</th><th>Calls</th><th>Answered</th><th>Users</th><th>Minutes</th>{SHOW_ACCURACY && <th>Accuracy</th>}</tr></thead>
          <tbody>
            {data.by_month.map((m) => (
              <tr key={m.month}><td>{monthName(m.month)}</td><td>{n(m.calls)}</td><td>{n(m.answered)}</td><td>{n(m.users)}</td><td>{n(m.minutes)}</td>{SHOW_ACCURACY && <td>{pct(m.avg_quality)}</td>}</tr>
            ))}
            {data.by_month.length === 0 && <tr><td colSpan={SHOW_ACCURACY ? 6 : 5}>No calls yet</td></tr>}
          </tbody>
        </table>
      </section>

      <h3 className="monitor-heading">Users &amp; numbers</h3>
      <div className="kpi-grid">
        <Kpi label="Accounts" value={n(data.users.total)} sub={`${n(data.users.admins)} admin · ${n(data.users.rejected)} rejected`} />
        <Kpi label="New sign-ups" value={n(data.users.new_30d)} sub={`last 30 days · ${n(data.users.new_7d)} this week`} />
        <Kpi label="Numbers linked" value={n(data.numbers.reduce((a, b) => a + b.n, 0))}
          sub={`${n(data.users.with_number)} users · ${data.numbers.map((k) => `${k.n} ${k.kind}`).join(', ') || 'none'}`} />
        {Object.entries(data.other).map(([k, v]) => <Kpi key={k} label={OTHER_LABEL[k] ?? k} value={n(v)} />)}
      </div>

      {data.top_users.length > 0 && (
        <>
          <h3 className="monitor-heading">Most active users</h3>
          <section className="setting-block dash-table">
            <table>
              <thead><tr><th>User</th><th>Calls</th><th>Minutes</th>{SHOW_ACCURACY && <th>Accuracy</th>}<th>Last call</th></tr></thead>
              <tbody>
                {data.top_users.map((u) => (
                  <tr key={u.user_id}><td>{u.name || `#${u.user_id}`}</td><td>{n(u.calls)}</td><td>{n(u.minutes)}</td>{SHOW_ACCURACY && <td>{pct(u.avg_quality)}</td>}<td>{u.last ?? '—'}</td></tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}

      <h3 className="monitor-heading">Languages, direction, misses</h3>
      <section className="setting-block dash-chips">
        <p><b>Languages</b> {data.languages.length ? data.languages.map((l) => <span className="chip" key={l.language}>{LANG[l.language] ?? l.language} · {l.n}</span>) : <span className="chip">none yet</span>}</p>
        <p><b>Direction</b> {data.direction.map((d) => <span className="chip" key={d.direction}>{d.direction === 'out' ? 'Outgoing' : 'Incoming'} · {d.n}</span>)}</p>
        <p><b>Missed because</b> {data.miss_reasons.length ? data.miss_reasons.map((m) => <span className="chip" key={m.reason}>{m.reason} · {m.n}</span>) : <span className="chip">no misses</span>}</p>
      </section>

      <h3 className="monitor-heading">System</h3>
      <div className="kpi-grid">
        <Kpi label="Night-watch runs" value={n(data.sentinel.runs)}
          tone={data.sentinel.last_ok == null ? undefined : data.sentinel.last_ok ? 'ok' : 'bad'}
          sub={data.sentinel.last_run ? `${n(data.sentinel.ok)} passed · last ${data.sentinel.last_run} ${data.sentinel.last_ok ? '✓' : '✗'}` : 'never run'} />
        <Kpi label="Characters voiced" value={n(c.tts_chars)} sub="typed and picture replies spoken to callers" />
        <Kpi label="App version" value={`v${__APP_VERSION__}`}
          sub={`built ${new Date(__BUILD_TIME__).toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}`} />
      </div>
    </main>
  )
}
