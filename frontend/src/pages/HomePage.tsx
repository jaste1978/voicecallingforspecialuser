import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { authFetch } from '../lib/auth'
import { LogoMark, CaptionsIcon, PhoneIcon } from '../components/icons'

export default function HomePage() {
  const navigate = useNavigate()
  const [number, setNumber] = useState('')
  const [hasOwn, setHasOwn] = useState(false)
  const [forwardCode, setForwardCode] = useState('')
  const [shared, setShared] = useState(false)
  const [codeCopied, setCodeCopied] = useState(false)
  const [testState, setTestState] = useState<'idle' | 'calling' | 'busy'>('idle')

  async function startTestCall() {
    setTestState('calling')
    try {
      const resp = await authFetch('/api/test-call', { method: 'POST' })
      if (resp.status === 409) {
        setTestState('busy')
        setTimeout(() => setTestState('idle'), 3000)
        return
      }
      // the call rings in a few seconds; callStore auto-navigates to /calls
      setTimeout(() => setTestState('idle'), 20000)
    } catch {
      setTestState('idle')
    }
  }

  useEffect(() => {
    authFetch('/api/me')
      .then((r) => r.json())
      .then((d) => {
        setNumber(d.number || '')
        setHasOwn(Boolean(d.has_own_number))
        setForwardCode(d.forward_code || '')
      })
      .catch(() => {})
  }, [])

  return (
    <main className="calls-home home-tab">
      <div className="home-brand">
        <span className="login-mark"><LogoMark size={26} /></span>
        <div>
          <b>SunoSathi</b>
          <small>सुनोसाथी · आपके कान, आपकी आवाज़</small>
        </div>
      </div>

      {hasOwn && number && (
        <div className="number-card">
          <div>
            <small>Your number</small>
            <b>{number}</b>
          </div>
          <button
            className="sharebtn"
            onClick={() => {
              const text = `Call me on ${number} — I read your words live with SunoSathi.`
              if (navigator.share) void navigator.share({ text })
              else {
                void navigator.clipboard?.writeText(text)
                setShared(true)
                setTimeout(() => setShared(false), 2000)
              }
            }}
          >
            {shared ? '✓ Copied' : 'Share'}
          </button>
        </div>
      )}

      {forwardCode && (
        <div className="setup-card">
          <p className="howto-title">Call forwarding · एक बार का setup</p>
          <p className="setup-text">Dial this code once from your phone — your calls then ring here:</p>
          <div className="forward-code-row">
            <code className="forward-code">{forwardCode}</code>
            <button
              className="promptbtn"
              onClick={() => {
                void navigator.clipboard?.writeText(forwardCode)
                setCodeCopied(true)
                setTimeout(() => setCodeCopied(false), 2000)
              }}
            >
              {codeCopied ? '✓' : 'Copy'}
            </button>
          </div>
          <p className="setup-text">To stop forwarding anytime: dial <b>##21#</b></p>
        </div>
      )}

      <button
        className="home-btn testcall"
        disabled={testState === 'calling'}
        onClick={() => void startTestCall()}
      >
        <span className="emoji icon">📞</span>
        <span>
          {testState === 'calling'
            ? 'Calling you… रुकिए'
            : testState === 'busy'
              ? 'A call is already running'
              : 'Try a test call · टेस्ट कॉल'}
          <small>
            {testState === 'calling'
              ? 'SunoSathi is calling — accept and watch the captions!'
              : 'SunoSathi calls you & speaks — see live captions in action'}
          </small>
        </span>
      </button>

      <button className="home-btn" onClick={() => { window.location.href = '/guide' }}>
        <span className="emoji icon"><CaptionsIcon size={28} /></span>
        <span>
          How to use · कैसे इस्तेमाल करें
          <small>Screen-by-screen guide with pictures</small>
        </span>
      </button>
      <button className="home-btn" onClick={() => navigate('/help')}>
        <span className="emoji icon"><HelpGlyph /></span>
        <span>
          Help &amp; FAQ · मदद
          <small>Answers to common questions</small>
        </span>
      </button>
      <button className="home-btn" onClick={() => navigate('/support')}>
        <span className="emoji icon"><PhoneIcon size={26} /></span>
        <span>
          Contact us · संपर्क करें
          <small>WhatsApp, email or send us a message</small>
        </span>
      </button>
    </main>
  )
}

function HelpGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.3a2.6 2.6 0 0 1 5 1c0 1.7-2.4 2-2.4 3.4" />
      <path d="M12 17h.01" />
    </svg>
  )
}
