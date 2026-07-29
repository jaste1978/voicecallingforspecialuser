import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { setAuth } from '../lib/auth'

export default function LoginPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const resp = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      if (!resp.ok) {
        setError('Wrong email or password')
        return
      }
      const d = await resp.json()
      setAuth(d.token, d.name || d.email, d.role)
      navigate('/', { replace: true })
    } catch {
      setError('Could not reach the server — try again')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="settings-page" style={{ justifyContent: 'center' }}>
      <section className="setting-block" style={{ marginTop: '8vh' }}>
        <h3>Welcome to SunoSathi 🙏</h3>
        <p className="idle-hint">Sign in to take your calls.</p>
        <form onSubmit={(e) => void submit(e)} style={{ display: 'grid', gap: 10, marginTop: 12 }}>
          <input
            className="dialinput"
            type="email"
            placeholder="Email"
            value={email}
            autoComplete="username"
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input
            className="dialinput"
            type="password"
            placeholder="Password"
            value={password}
            autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          {error && <p className="status-line error">{error}</p>}
          <button className="bigbtn start" type="submit" disabled={busy || !email || !password}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <p className="idle-hint" style={{ marginTop: 14 }}>
          No account yet? Join the pilot at{' '}
          <a href="https://sunosathi.com/#pilot">sunosathi.com</a> and we'll set you up.
        </p>
      </section>
    </main>
  )
}
