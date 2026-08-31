import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { LogoMark } from '../components/icons'
import { track } from '../lib/analytics'

export default function RegisterPage() {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [number, setNumber] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  const numberOk = number.replace(/\D/g, '').replace(/^91/, '').length === 10

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const resp = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password, number }),
      })
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
            service stays safe. You will get a WhatsApp/SMS on{' '}
            <strong>{number}</strong> once your account is ready — usually within a day.
          </p>
          <p className="idle-hint">
            आपका खाता जल्द चालू होगा। तैयार होते ही हम आपको WhatsApp/SMS करेंगे।
          </p>
          <button className="bigbtn start" style={{ marginTop: 14 }} onClick={() => navigate('/login')}>
            Back to sign in
          </button>
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
        <form onSubmit={(e) => void submit(e)} style={{ display: 'grid', gap: 10, marginTop: 12 }}>
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
          {error && <p className="status-line error">{error}</p>}
          <button
            className="bigbtn start"
            type="submit"
            disabled={busy || !name.trim() || !email || password.length < 8 || !numberOk}
          >
            {busy ? 'Sending…' : 'Request my account'}
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
