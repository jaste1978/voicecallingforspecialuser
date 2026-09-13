import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { LogoMark } from '../components/icons'
import { track } from '../lib/analytics'

const TURNSTILE_SITEKEY = '0x4AAAAAAEqa3x_MLNDKWW_D'

export default function RegisterPage() {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [number, setNumber] = useState('')
  const [otp, setOtp] = useState('')
  const [step, setStep] = useState<'form' | 'otp'>('form')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  const numberOk = number.replace(/\D/g, '').replace(/^91/, '').length === 10

  // Cloudflare Turnstile: invisible bot check, renders into the form div
  useEffect(() => {
    if (document.getElementById('turnstile-js')) return
    const s = document.createElement('script')
    s.id = 'turnstile-js'
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js'
    s.async = true
    document.head.appendChild(s)
  }, [])

  // Step 1: verify the human, then email a 6-digit code to prove the inbox.
  async function sendCode(e?: React.FormEvent) {
    e?.preventDefault()
    setBusy(true)
    setError('')
    try {
      const token = (document.querySelector(
        'input[name="cf-turnstile-response"]') as HTMLInputElement | null)?.value || ''
      const resp = await fetch('/api/register/otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, 'cf-turnstile-response': token }),
      })
      if (resp.status === 403) {
        setError('Could not verify you are human — wait a moment and try again. फिर से कोशिश कीजिए।')
        return
      }
      if (resp.status === 409) {
        setError('This email already has an account — try signing in instead.')
        return
      }
      if (!resp.ok) {
        setError('Could not send the code — check the email address and try again.')
        return
      }
      setStep('otp')
    } catch {
      setError('Could not reach the server — try again')
    } finally {
      setBusy(false)
    }
  }

  // Step 2: the code is the gate; a verified inbox creates the account.
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const resp = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password, number, otp }),
      })
      if (resp.status === 403) {
        setError('Wrong or expired code — check the email or send a new code. Code ग़लत या पुराना है।')
        return
      }
      if (resp.status === 409) {
        setError('This email already has an account — try signing in instead.')
        return
      }
      if (!resp.ok) {
        setError('Please check the details: valid email, password of 8+ characters, 10-digit mobile number.')
        return
      }
      setDone(true)
      track('sign_up')
    } catch {
      setError('Could not reach the server — try again')
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <main className="settings-page login-page">
        <div className="login-brand">
          <span className="login-mark"><LogoMark size={30} /></span>
          <h2>SunoSathi <span className="login-devanagari">सुनोसाथी</span></h2>
        </div>
        <section className="setting-block">
          <h3>Request sent 🙏 · आवेदन मिल गया</h3>
          <p>
            Thank you, <strong>{name}</strong>! We check every request personally so the
            service stays safe. You will get an email and a WhatsApp/SMS on{' '}
            <strong>{number}</strong> once your account is ready — usually within a day.
          </p>
          <p className="idle-hint">
            आपका खाता जल्द चालू होगा। तैयार होते ही हम आपको email और WhatsApp/SMS करेंगे।
          </p>
          <button className="bigbtn start" style={{ marginTop: 14 }} onClick={() => navigate('/login')}>
            Back to sign in
          </button>
        </section>
      </main>
    )
  }

  if (step === 'otp') {
    return (
      <main className="settings-page login-page">
        <div className="login-brand">
          <span className="login-mark"><LogoMark size={30} /></span>
          <h2>SunoSathi <span className="login-devanagari">सुनोसाथी</span></h2>
        </div>
        <section className="setting-block">
          <h3>Check your email · अपना email देखिए</h3>
          <p className="idle-hint">
            We sent a 6-digit code to <strong>{email}</strong>. Enter it here —
            it proves the email is really yours. Spam folder भी देख लीजिए।
          </p>
          <form onSubmit={(e) => void submit(e)} style={{ display: 'grid', gap: 10, marginTop: 12 }}>
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
            {error && <p className="status-line error">{error}</p>}
            <button className="bigbtn start" type="submit" disabled={busy || otp.length !== 6}>
              {busy ? 'Checking…' : 'Verify & create account'}
            </button>
          </form>
          <p className="idle-hint" style={{ marginTop: 14 }}>
            Nothing arrived?{' '}
            <a href="#" onClick={(e) => { e.preventDefault(); if (!busy) void sendCode() }}>
              Send a new code
            </a>
            {' · '}
            <a href="#" onClick={(e) => { e.preventDefault(); setStep('form'); setOtp(''); setError('') }}>
              Change email
            </a>
          </p>
        </section>
      </main>
    )
  }

  return (
    <main className="settings-page login-page">
      <div className="login-brand">
        <span className="login-mark"><LogoMark size={30} /></span>
        <h2>SunoSathi <span className="login-devanagari">सुनोसाथी</span></h2>
        <p className="idle-hint">Your phone number. Their voice, your eyes.</p>
      </div>
      <section className="setting-block">
        <h3>Create your account · खाता बनाइए</h3>
        <p className="idle-hint">
          Fill this once — we approve every account personally, then your calls
          start ringing here with live captions.
        </p>
        <form onSubmit={(e) => void sendCode(e)} style={{ display: 'grid', gap: 10, marginTop: 12 }}>
          <input
            className="dialinput"
            placeholder="Your name · आपका नाम"
            value={name}
            autoComplete="name"
            onChange={(e) => setName(e.target.value)}
            required
          />
          <input
            className="dialinput"
            type="email"
            placeholder="Email"
            value={email}
            autoComplete="email"
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input
            className="dialinput"
            type="password"
            placeholder="Password (8+ characters)"
            value={password}
            autoComplete="new-password"
            minLength={8}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <input
            className="dialinput"
            type="tel"
            placeholder="Mobile number to forward · मोबाइल नंबर"
            value={number}
            autoComplete="tel"
            onChange={(e) => setNumber(e.target.value)}
            required
          />
          <p className="idle-hint" style={{ margin: 0 }}>
            This is the number your callers already dial — after approval you
            forward it to SunoSathi with one code.
          </p>
          <div className="cf-turnstile" data-sitekey={TURNSTILE_SITEKEY}
            data-theme="light" />
          {error && <p className="status-line error">{error}</p>}
          <button
            className="bigbtn start"
            type="submit"
            disabled={busy || !name.trim() || !email || password.length < 8 || !numberOk}
          >
            {busy ? 'Sending…' : 'Email me a code · code भेजिए'}
          </button>
        </form>
        <p className="idle-hint" style={{ marginTop: 14 }}>
          Already have an account?{' '}
          <a href="/login" onClick={(e) => { e.preventDefault(); navigate('/login') }}>Sign in</a>
        </p>
      </section>
    </main>
  )
}
