import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PhoneIcon, CaptionsIcon, MicIcon, LogoMark } from '../components/icons'

// A captioned call, demonstrating itself — no sound needed.
const DEMOS = [
  {
    caller: 'माँ',
    lang: 'हिन्दी',
    lines: [
      { who: 'in', text: 'कैसी हो बेटा? खाना खाया?' },
      { who: 'out', text: '🎤 हाँ माँ, बस अभी खाया। आप बताओ?' },
      { who: 'in', text: 'यहाँ सब बढ़िया। रविवार को आ रही हो ना?' },
    ],
  },
  {
    caller: 'દાદી',
    lang: 'ગુજરાતી',
    lines: [
      { who: 'in', text: 'કેમ છો? રવિવારે આરતી માં આવો છો ને?' },
      { who: 'out', text: '🎤 હા દાદી, ચોક્કસ આવીશ.' },
      { who: 'in', text: 'સરસ! બધા રાહ જુએ છે.' },
    ],
  },
]

const TYPE_MS = 55        // per character — caption "typing in" live
const LINE_PAUSE_MS = 900
const DEMO_PAUSE_MS = 1600

export default function StartPage() {
  const navigate = useNavigate()
  const [demoIdx, setDemoIdx] = useState(0)
  const [shown, setShown] = useState<{ who: string; text: string }[]>([])
  const [typing, setTyping] = useState('')
  // waitlist sheet
  const [joining, setJoining] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const timeouts = useRef<ReturnType<typeof setTimeout>[]>([])

  useEffect(() => {
    let cancelled = false
    const later = (fn: () => void, ms: number) => {
      const t = setTimeout(() => { if (!cancelled) fn() }, ms)
      timeouts.current.push(t)
    }

    function playLine(demo: typeof DEMOS[number], lineIdx: number) {
      if (lineIdx >= demo.lines.length) {
        later(() => {
          setShown([])
          setTyping('')
          setDemoIdx((demoIdx + 1) % DEMOS.length)
        }, DEMO_PAUSE_MS)
        return
      }
      const line = demo.lines[lineIdx]
      let chars = 0
      const tick = () => {
        chars += 1
        setTyping(line.text.slice(0, chars))
        if (chars < line.text.length) {
          later(tick, TYPE_MS)
        } else {
          setShown((prev) => [...prev, line])
          setTyping('')
          later(() => playLine(demo, lineIdx + 1), LINE_PAUSE_MS)
        }
      }
      tick()
    }

    playLine(DEMOS[demoIdx], 0)
    return () => {
      cancelled = true
      timeouts.current.forEach(clearTimeout)
      timeouts.current = []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demoIdx])

  const demo = DEMOS[demoIdx]
  const typingWho = demo.lines[shown.length]?.who ?? 'in'

  async function joinPilot() {
    setError('')
    if (!name.trim() || !email.includes('@')) {
      setError('Please add your name and a valid email')
      return
    }
    try {
      const resp = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), role: 'app', message: 'Joined from the app welcome screen' }),
      })
      if (!resp.ok) throw new Error()
      setSent(true)
    } catch {
      setError('Could not reach the server — try again')
    }
  }

  return (
    <main className="start-page">
      <div className="start-brand">
        <span className="login-mark"><LogoMark size={28} /></span>
        <h1>SunoSathi <span className="login-devanagari">सुनोसाथी</span></h1>
      </div>

      <h2 className="start-tagline">
        अब हर call आँखों से <span className="hi">पढ़िए</span>,<br />
        अपनी आवाज़ से जवाब दीजिए।
      </h2>
      <p className="start-sub">Read every call live. Reply with your own voice.</p>

      <div className="demo-card" aria-hidden="true">
        <div className="demo-head">
          <span className="demo-caller">{demo.caller}</span>
          <span className="demo-lang">Auto · {demo.lang}</span>
          <span className="demo-timer">0:12</span>
        </div>
        <div className="demo-body">
          {shown.map((l, i) => (
            <div key={i} className={`bubble ${l.who === 'out' ? 'out' : 'in'} demo-bubble`}>
              {l.text}
            </div>
          ))}
          {typing && (
            <div className={`bubble ${typingWho === 'out' ? 'out' : 'in'} demo-bubble`}>
              {typing}<span className="caret" />
            </div>
          )}
        </div>
      </div>

      <div className="start-steps">
        <span><i className="step-ic"><PhoneIcon size={20} /></i>Calls ring here</span>
        <span><i className="step-ic"><CaptionsIcon size={20} /></i>You read, live</span>
        <span><i className="step-ic"><MicIcon size={20} /></i>You speak, they hear</span>
      </div>

      <button className="bigbtn start start-cta" onClick={() => navigate('/login')}>
        Sign in · साइन इन
      </button>

      {!joining && !sent && (
        <button className="historylink" onClick={() => setJoining(true)}>
          New here? Join the pilot →
        </button>
      )}
      {joining && !sent && (
        <div className="join-sheet">
          <input className="dialinput" placeholder="Your name" value={name}
            onChange={(e) => setName(e.target.value)} />
          <input className="dialinput" type="email" placeholder="Email" value={email}
            onChange={(e) => setEmail(e.target.value)} />
          {error && <p className="status-line error">{error}</p>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="promptbtn" onClick={() => setJoining(false)}>Cancel</button>
            <button className="bigbtn start" style={{ minHeight: 46 }} onClick={() => void joinPilot()}>
              Request access
            </button>
          </div>
        </div>
      )}
      {sent && (
        <p className="start-sub" style={{ fontWeight: 600 }}>
          🙏 धन्यवाद! We got your request — we'll reach out soon.
        </p>
      )}
    </main>
  )
}
