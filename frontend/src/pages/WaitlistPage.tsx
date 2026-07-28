import { useEffect, useState } from 'react'

interface Signup {
  id: number
  name: string
  email: string
  role: string
  org: string
  message: string
  created_at: number
}

export default function WaitlistPage() {
  const [key, setKey] = useState(() => localStorage.getItem('adminKey') || '')
  const [input, setInput] = useState('')
  const [signups, setSignups] = useState<Signup[] | null>(null)
  const [error, setError] = useState('')

  async function load(k: string) {
    setError('')
    const resp = await fetch('/api/waitlist', { headers: { 'X-Admin-Key': k } })
    if (resp.status === 403) {
      setError('Wrong admin key')
      localStorage.removeItem('adminKey')
      setKey('')
      return
    }
    const d = await resp.json()
    setSignups(d.signups)
  }

  useEffect(() => {
    if (key) void load(key)
  }, [key])

  if (!key) {
    return (
      <main className="settings-page">
        <section className="setting-block">
          <h3>Admin key required</h3>
          <p className="idle-hint">
            Waitlist signups contain personal emails, so this page needs the
            admin key (stored only on this device).
          </p>
          <input
            className="dialinput"
            type="password"
            placeholder="Admin key"
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
          {error && <p className="status-line error">{error}</p>}
          <button
            className="bigbtn start"
            style={{ marginTop: 10 }}
            disabled={!input.trim()}
            onClick={() => {
              localStorage.setItem('adminKey', input.trim())
              setKey(input.trim())
            }}
          >
            Unlock
          </button>
        </section>
      </main>
    )
  }

  if (!signups) return <main className="stub">Loading…</main>

  return (
    <main className="settings-page">
      <h3 className="monitor-heading">
        {signups.length} signup{signups.length === 1 ? '' : 's'}
      </h3>
      {signups.map((s) => (
        <section className="setting-block" key={s.id}>
          <strong>{s.name}</strong>{' '}
          <a href={`mailto:${s.email}`}>{s.email}</a>
          <p className="idle-hint" style={{ textAlign: 'left' }}>
            {s.role}
            {s.org && <> · {s.org}</>}
            {' · '}
            {new Date(s.created_at * 1000).toLocaleString([], {
              day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
            })}
          </p>
          {s.message && <p style={{ marginTop: 6 }}>💬 {s.message}</p>}
        </section>
      ))}
      {signups.length === 0 && (
        <p className="idle-hint">No signups yet — share sunosathi.com!</p>
      )}
    </main>
  )
}
