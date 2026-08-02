import { useEffect, useState } from 'react'
import { authFetch } from '../lib/auth'
import { fmtNumber, fmtRelative, fmtDuration } from '../lib/format'

interface CostRow {
  id: number
  from_number: string
  direction: string
  started_at: number
  duration_s: number
  answered: boolean
  tts_chars: number
  stt: number
  batch: number
  tts: number
  vobiz: number
  total: number
  vobiz_reported: boolean
}

interface Totals {
  calls: number
  minutes: number
  stt: number
  batch: number
  tts: number
  vobiz: number
  total: number
}

interface CostData {
  rates: Record<string, number>
  totals: Record<string, Totals>
  calls: CostRow[]
}

const RATE_LABELS: Record<string, string> = {
  sarvam_stt_per_min: 'Sarvam live captions — ₹ per minute',
  sarvam_batch_per_min: 'Sarvam quality re-check — ₹ per minute',
  sarvam_tts_per_1k_chars: 'Sarvam voice (TTS) — ₹ per 1,000 characters',
  vobiz_in_per_min: 'Vobiz incoming call — ₹ per minute',
  vobiz_out_per_min: 'Vobiz outgoing call — ₹ per minute',
}

const inr = (v: number) => `₹${v.toFixed(2)}`

export default function CostsPage() {
  const [data, setData] = useState<CostData | null>(null)
  const [rates, setRates] = useState<Record<string, string>>({})
  const [saved, setSaved] = useState(false)

  function load() {
    authFetch('/api/costs')
      .then((r) => r.json())
      .then((d: CostData) => {
        setData(d)
        setRates(Object.fromEntries(Object.entries(d.rates).map(([k, v]) => [k, String(v)])))
      })
      .catch(() => {})
  }

  useEffect(load, [])

  async function saveRates() {
    const payload = Object.fromEntries(
      Object.entries(rates)
        .map(([k, v]) => [k, parseFloat(v)])
        .filter(([, v]) => !Number.isNaN(v as number)),
    )
    await authFetch('/api/costs', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
    load()
  }

  if (!data) return <main className="settings-page"><p className="idle-hint">Loading…</p></main>

  const windows: [string, string][] = [['today', 'Today'], ['week', '7 days'], ['month', '30 days']]

  return (
    <main className="settings-page">
      <div className="cost-cards">
        {windows.map(([key, label]) => {
          const t = data.totals[key]
          return (
            <div className="cost-card" key={key}>
              <small>{label}</small>
              <b>{inr(t.total)}</b>
              <span>{t.calls} calls · {t.minutes.toFixed(0)} min
                {t.minutes > 0 && ` · ${inr(t.total / t.minutes)}/min`}</span>
            </div>
          )
        })}
      </div>

      <section className="setting-block">
        <h3>Where the money goes (30 days)</h3>
        {(() => {
          const t = data.totals.month
          const parts = [
            ['Vobiz telephony', t.vobiz],
            ['Sarvam live captions', t.stt],
            ['Sarvam quality re-check', t.batch],
            ['Sarvam voice (TTS)', t.tts],
          ] as [string, number][]
          return parts.map(([label, v]) => (
            <div className="cost-line" key={label}>
              <span>{label}</span>
              <div className="cost-bar">
                <div className="cost-bar-fill" style={{ width: `${t.total ? Math.max(2, (v / t.total) * 100) : 0}%` }} />
              </div>
              <b>{inr(v)}</b>
            </div>
          ))
        })()}
      </section>

      <section className="setting-block">
        <h3>Rates</h3>
        <p className="idle-hint" style={{ textAlign: 'left' }}>
          Set these from your vendor invoices — every cost below is usage × rate.
          When Vobiz reports a real billed amount on a call, that amount is used directly.
        </p>
        {Object.keys(RATE_LABELS).map((k) => (
          <div className="rate-row" key={k}>
            <span>{RATE_LABELS[k]}</span>
            <input
              className="dialinput rate-input"
              type="number"
              step="0.01"
              min="0"
              value={rates[k] ?? ''}
              onChange={(e) => setRates((p) => ({ ...p, [k]: e.target.value }))}
            />
          </div>
        ))}
        <button className="bigbtn start" style={{ minHeight: 46, marginTop: 10 }} onClick={() => void saveRates()}>
          {saved ? '✓ Saved' : 'Save rates'}
        </button>
      </section>

      <section className="setting-block">
        <h3>Per-call costs (last 50)</h3>
        <div className="cost-table-wrap">
          <table className="cost-table">
            <thead>
              <tr><th>Call</th><th>Min</th><th>Vobiz</th><th>STT</th><th>Check</th><th>TTS</th><th>Total</th></tr>
            </thead>
            <tbody>
              {data.calls.map((c) => (
                <tr key={c.id} className={c.answered ? '' : 'cost-missed'}>
                  <td>
                    <b>{fmtNumber(c.from_number)}</b>
                    <small>{c.direction === 'out' ? '↗ ' : '↙ '}{fmtRelative(c.started_at)}</small>
                  </td>
                  <td>{c.answered ? fmtDuration(c.duration_s) : '—'}</td>
                  <td>{inr(c.vobiz)}{c.vobiz_reported ? '✓' : ''}</td>
                  <td>{inr(c.stt)}</td>
                  <td>{inr(c.batch)}</td>
                  <td>{c.tts_chars > 0 ? inr(c.tts) : '—'}</td>
                  <td><b>{inr(c.total)}</b></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="idle-hint" style={{ textAlign: 'left', fontSize: 13 }}>
          ✓ = amount reported by Vobiz itself. Others are usage × your rates.
          TTS phrase caching means repeated quick-phrases cost less than shown.
        </p>
      </section>
    </main>
  )
}
