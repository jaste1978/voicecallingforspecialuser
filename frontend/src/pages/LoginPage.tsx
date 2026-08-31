import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { setAuth } from '../lib/auth'
import { LogoMark } from '../components/icons'
import { track } from '../lib/analytics'

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
      if (resp.status === 403) {
        const d = await resp.json().catch(() => ({}))
        setError(
          d.reason === 'pending'
            ? 'Your account is waiting for approval — we will SMS/WhatsApp you when it is ready. आपका खाता जल्द चालू होगा।'
            : 'This account was not approved. Contact us from the Support page.',
        )
        return
      }
      if (!resp.ok) {
        setError('Wrong email or password')
        return
      }
      const d = await resp.json()
      setAuth(d.token, d.name || d.email, d.role)
      track('login')
      navigate('/', { replace: true })
    } catch {
      setError('Could not reach the server — try again')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="settings-page login-page">
      <div className="login-brand">
        <span className="login-mark"><LogoMark size={30} /></span>
        <h2>SunoSathi <span className="login-devanagari">सुनोसाथी</span></h2>
        <p className="idle-hint">Your phone number. Their voice, your eyes.</p>
      </div>
      <section className="setting-block">
        <h3>Welcome back 🙏</h3>
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
          No account yet?{' '}
          <a href="/register" onClick={(e) => { e.preventDefault(); navigate('/register') }}>
            Create one here
          </a>{' '}
          — it takes a minute.
        </p>
      </section>
    </main>
  )
}
