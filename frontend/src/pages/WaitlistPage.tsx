import { useEffect, useState } from 'react'
import { authFetch } from '../lib/auth'

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
  const [signups, setSignups] = useState<Signup[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    authFetch('/api/waitlist')
      .then(async (resp) => {
        if (resp.status === 403) {
          setError('This page is for the admin account only.')
          return
        }
        const d = await resp.json()
        setSignups(d.signups)
      })
      .catch(() => setError('Could not load signups — check your connection.'))
  }, [])

  if (error) return <main className="stub">{error}</main>
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
