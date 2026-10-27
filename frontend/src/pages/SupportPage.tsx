import { useEffect, useState } from 'react'
import { authFetch } from '../lib/auth'

const WHATSAPP = 'https://wa.me/919819095969?text=' +
  encodeURIComponent('Namaste! मुझे SunoSathi में मदद चाहिए —')
const EMAIL = 'tnlangalia@gmail.com'

export default function SupportPage() {
  const [message, setMessage] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  // account / data deletion
  const [del, setDel] = useState<{ pending: boolean; delete_after: number | null } | null>(null)
  const [mode, setMode] = useState<'' | 'account' | 'calls'>('')
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')

  useEffect(() => {
    authFetch('/api/account/delete-status')
      .then((r) => r.json())
      .then(setDel)
      .catch(() => {})
  }, [])

  async function requestDelete() {
    setBusy(true); setNote('')
    try {
      const r = await authFetch('/api/account/delete-request', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pw }),
      })
      const d = await r.json()
      if (!r.ok) { setNote(d.error === 'wrong password' ? 'Wrong password' : 'Could not schedule — try again'); return }
      setDel({ pending: true, delete_after: d.delete_after }); setMode(''); setPw('')
    } catch { setNote('Could not reach the server') } finally { setBusy(false) }
  }

  async function cancelDelete() {
    setBusy(true)
    try {
      await authFetch('/api/account/delete-cancel', { method: 'POST' })
      setDel({ pending: false, delete_after: null })
    } finally { setBusy(false) }
  }

  async function clearCalls() {
    setBusy(true); setNote('')
    try {
      const r = await authFetch('/api/account/clear-calls', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pw }),
      })
      const d = await r.json()
      if (!r.ok) { setNote(d.error === 'wrong password' ? 'Wrong password' : 'Could not clear — try again'); return }
      setNote(`✓ Cleared ${d.calls ?? 0} calls and their recordings.`); setMode(''); setPw('')
    } catch { setNote('Could not reach the server') } finally { setBusy(false) }
  }

  async function send() {
    setError('')
    if (!message.trim()) return
    try {
      const resp = await authFetch('/api/support', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'support', message: message.trim() }),
      })
      if (!resp.ok) throw new Error()
      setSent(true)
    } catch {
      setError('Could not send — try WhatsApp below')
    }
  }

  return (
    <main className="settings-page">
      <section className="setting-block">
        <h3>WhatsApp पर बात कीजिए 💬</h3>
        <p className="idle-hint" style={{ textAlign: 'left' }}>
          सबसे तेज़ तरीका — typing से ही बात होगी, आवाज़ की ज़रूरत नहीं।
        </p>
        <a className="bigbtn start" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 52, textDecoration: 'none', marginTop: 10 }} href={WHATSAPP} target="_blank" rel="noreferrer">
          WhatsApp us
        </a>
      </section>

      <section className="setting-block">
        <h3>Message भेजिए</h3>
        {sent ? (
          <p className="idle-hint" style={{ textAlign: 'left', fontWeight: 600 }}>
            🙏 मिल गया! हम जल्दी जवाब देंगे — usually within a day.
          </p>
        ) : (
          <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>
            <textarea
              className="dialinput"
              rows={4}
              placeholder="अपनी बात लिखिए… what do you need help with?"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={1000}
              style={{ resize: 'vertical', borderRadius: 16 }}
            />
            {error && <p className="status-line error">{error}</p>}
            <button className="bigbtn start" style={{ minHeight: 48 }} disabled={!message.trim()} onClick={() => void send()}>
              Send message
            </button>
          </div>
        )}
      </section>

      <section className="setting-block">
        <h3>Email</h3>
        <p className="idle-hint" style={{ textAlign: 'left' }}>
          <a href={`mailto:${EMAIL}`}>{EMAIL}</a>
        </p>
      </section>

      <section className="setting-block">
        <h3>Privacy &amp; data 🔒</h3>
        {del?.pending ? (
          <>
            <p className="idle-hint" style={{ textAlign: 'left' }}>
              🗑 Your account &amp; data are scheduled for deletion
              {del.delete_after ? ` around ${new Date(del.delete_after * 1000).toLocaleString()}` : ''}.
              You can cancel until then.
            </p>
            <button className="bigbtn start" style={{ minHeight: 48, marginTop: 10 }}
              disabled={busy} onClick={() => void cancelDelete()}>
              Cancel deletion
            </button>
          </>
        ) : (
          <>
            <p className="idle-hint" style={{ textAlign: 'left' }}>
              Delete your call history, or your whole account and all data. More at{' '}
              <a href="https://sunosathi.com/delete-data" target="_blank" rel="noreferrer">
                sunosathi.com/delete-data</a>.
            </p>
            {mode === '' ? (
              <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>
                <button className="promptbtn" onClick={() => { setMode('calls'); setNote('') }}>
                  Clear my call history
                </button>
                <button className="promptbtn" style={{ color: 'var(--danger)' }}
                  onClick={() => { setMode('account'); setNote('') }}>
                  Delete my account &amp; data
                </button>
                {note && <p className="status-line">{note}</p>}
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>
                <p className="idle-hint" style={{ textAlign: 'left', fontWeight: 600 }}>
                  {mode === 'account'
                    ? 'This deletes your account and everything in it after a 12-hour grace window. Enter your password to confirm.'
                    : 'This permanently removes your calls, transcripts and recordings (your account stays). Enter your password to confirm.'}
                </p>
                <input className="dialinput" type="password" placeholder="Your password"
                  value={pw} onChange={(e) => setPw(e.target.value)} />
                {note && <p className="status-line error">{note}</p>}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="promptbtn" onClick={() => { setMode(''); setPw(''); setNote('') }}>
                    Cancel
                  </button>
                  <button className="bigbtn start" style={{ minHeight: 46, flex: 1 }}
                    disabled={busy || !pw}
                    onClick={() => void (mode === 'account' ? requestDelete() : clearCalls())}>
                    {mode === 'account' ? 'Schedule deletion' : 'Clear call history'}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </section>
    </main>
  )
}
