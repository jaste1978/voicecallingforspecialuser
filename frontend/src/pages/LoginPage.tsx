import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { setAuth } from '../lib/auth'
import { LogoMark } from '../components/icons'
import { track } from '../lib/analytics'

const TURNSTILE_SITEKEY = '0x4AAAAAAEqa3x_MLNDKWW_D'

type Mode = 'login' | 'forgot' | 'reset' | 'done'

export default function LoginPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [mode, setMode] = useState<Mode>('login')
  // reset flow
  const [otp, setOtp] = useState('')
  const [newpw, setNewpw] = useState('')
  const [confirmpw, setConfirmpw] = useState('')
  const widgetRef = useRef<string | null>(null)

  // Turnstile: load the script once; the widget itself is rendered on demand
  // when the forgot-password step appears (it is not in the initial DOM).
  useEffect(() => {
    if (document.getElementById('turnstile-js')) return
    const s = document.createElement('script')
    s.id = 'turnstile-js'
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js'
    s.async = true
    document.head.appendChild(s)
  }, [])

  useEffect(() => {
    if (mode !== 'forgot') return
    let cancelled = false
    const render = () => {
      const ts = (window as unknown as { turnstile?: any }).turnstile
      const el = document.getElementById('cf-forgot')
      if (ts && el && widgetRef.current === null) {
        widgetRef.current = ts.render('#cf-forgot', {
          sitekey: TURNSTILE_SITEKEY, theme: 'light',
        })
      } else if (!ts && !cancelled) {
        setTimeout(render, 300)
      }
    }
    render()
    return () => { cancelled = true; widgetRef.current = null }
  }, [mode])

  function goForgot() {
    setMode('forgot')
    setError('')
    setOtp(''); setNewpw(''); setConfirmpw('')
  }

  // Step 1: ask the server to email a reset code. The response never reveals
  // whether the account exists, so we always advance to the code step.
  async function sendResetCode(e?: React.FormEvent) {
    e?.preventDefault()
    if (!email) { setError('Type your email first'); return }
    setBusy(true)
    setError('')
    try {
      const ts = (window as unknown as { turnstile?: any }).turnstile
      const token = (ts && widgetRef.current ? ts.getResponse(widgetRef.current) : '') || ''
      const resp = await fetch('/api/forgot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, 'cf-turnstile-response': token }),
      })
      if (resp.status === 403) {
        setError('Could not verify you are human — wait a moment and try again. फिर से कोशिश कीजिए।')
        return
      }
      setMode('reset')
    } catch {
      setError('Could not reach the server — try again')
    } finally {
      setBusy(false)
    }
  }

  // Step 2: the code + a new password resets the account everywhere.
  async function doReset(e: React.FormEvent) {
    e.preventDefault()
    if (newpw.length < 8) { setError('Password must be at least 8 characters'); return }
    if (newpw !== confirmpw) { setError('The two passwords do not match · दोनों password एक जैसे नहीं हैं'); return }
    setBusy(true)
    setError('')
    try {
      const resp = await fetch('/api/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, otp, password: newpw }),
      })
      if (resp.status === 403) {
        setError('Wrong or expired code — check your email or send a new code. Code ग़लत या पुराना है।')
        return
      }
      if (!resp.ok) {
        setError('Please use a password of 8+ characters.')
        return
      }
      setPassword('')
      setOtp(''); setNewpw(''); setConfirmpw('')
      setMode('done')
    } catch {
      setError('Could not reach the server — try again')
    } finally {
      setBusy(false)
    }
  }

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

  const brand = (
    <div className="login-brand">
      <span className="login-mark"><LogoMark size={30} /></span>
      <h2>SunoSathi <span className="login-devanagari">सुनोसाथी</span></h2>
      <p className="idle-hint">Your phone number. Their voice, your eyes.</p>
    </div>
  )

  if (mode === 'forgot') {
    return (
      <main className="settings-page login-page">
        {brand}
        <section className="setting-block">
          <h3>Reset your password · पासवर्ड reset कीजिए</h3>
          <p className="idle-hint">
            Enter your email and we will send a 6-digit code to set a new
            password. अपना email लिखिए — हम code भेजेंगे।
          </p>
          <form onSubmit={(e) => void sendResetCode(e)} style={{ display: 'grid', gap: 10, marginTop: 12 }}>
            <input
              className="dialinput"
              type="email"
              placeholder="Email"
              value={email}
              autoComplete="username"
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            />
            <div id="cf-forgot" className="cf-turnstile" />
            {error && <p className="status-line error">{error}</p>}
            <button className="bigbtn start" type="submit" disabled={busy || !email}>
              {busy ? 'Sending…' : 'Email me a code · code भेजिए'}
            </button>
          </form>
          <p className="idle-hint" style={{ marginTop: 14 }}>
            <a href="#" onClick={(e) => { e.preventDefault(); setMode('login'); setError('') }}>
              ← Back to sign in
            </a>
          </p>
        </section>
      </main>
    )
  }

  if (mode === 'reset') {
    return (
      <main className="settings-page login-page">
        {brand}
        <section className="setting-block">
          <h3>Check your email · अपना email देखिए</h3>
          <p className="idle-hint">
            If <strong>{email}</strong> has an account, a 6-digit code is on its
            way. Enter it with your new password. Spam folder भी देख लीजिए।
          </p>
          <form onSubmit={(e) => void doReset(e)} style={{ display: 'grid', gap: 10, marginTop: 12 }}>
            <input
              className="dialinput"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              placeholder="6-digit code · code लिखिए"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
              style={{ textAlign: 'center', letterSpacing: 6, fontSize: 22 }}
              required
              autoFocus
            />
            <input
              className="dialinput"
              type="password"
              placeholder="New password (8+ characters)"
              value={newpw}
              autoComplete="new-password"
              minLength={8}
              onChange={(e) => setNewpw(e.target.value)}
              required
            />
            <input
              className="dialinput"
              type="password"
              placeholder="Repeat new password · दोबारा लिखिए"
              value={confirmpw}
              autoComplete="new-password"
              minLength={8}
              onChange={(e) => setConfirmpw(e.target.value)}
              required
            />
            {error && <p className="status-line error">{error}</p>}
            <button className="bigbtn start" type="submit" disabled={busy || otp.length !== 6 || newpw.length < 8}>
              {busy ? 'Resetting…' : 'Set new password · नया password'}
            </button>
          </form>
          <p className="idle-hint" style={{ marginTop: 14 }}>
            Nothing arrived?{' '}
            <a href="#" onClick={(e) => { e.preventDefault(); goForgot() }}>
              Send a new code
            </a>
            {' · '}
            <a href="#" onClick={(e) => { e.preventDefault(); setMode('login'); setError('') }}>
              Back to sign in
            </a>
          </p>
        </section>
      </main>
    )
  }

  if (mode === 'done') {
    return (
      <main className="settings-page login-page">
        {brand}
        <section className="setting-block">
          <h3>Password changed 🎉 · पासवर्ड बदल गया</h3>
          <p>
            Your password has been reset. Sign in with your new password — on
            every device. अब नए password से sign in कीजिए।
          </p>
          <button className="bigbtn start" style={{ marginTop: 14 }} onClick={() => { setMode('login'); setError('') }}>
            Sign in · sign in कीजिए
          </button>
        </section>
      </main>
    )
  }

  return (
    <main className="settings-page login-page">
      {brand}
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
          <button type="button" className="historylink" onClick={goForgot}>
            Forgot password? · पासवर्ड भूल गए?
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
