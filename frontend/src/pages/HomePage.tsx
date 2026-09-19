import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { authFetch } from '../lib/auth'
import TestCallButton from '../components/TestCallButton'

interface Callback {
  id: number
  caller_number: string
  created_at: number
  seen: number
}

function fmtNumber(n: string): string {
  const d = (n || '').replace(/\D/g, '')
  return d.length === 10 ? `+91 ${d.slice(0, 5)} ${d.slice(5)}` : (n || '')
}

function timeAgo(ts: number): string {
  const s = Math.max(0, Date.now() / 1000 - ts)
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export default function HomePage() {
  const navigate = useNavigate()
  const [number, setNumber] = useState('')
  const [hasOwn, setHasOwn] = useState(false)
  const [handle, setHandle] = useState('')
  const [handleCopied, setHandleCopied] = useState(false)
  const [forwardCode, setForwardCode] = useState('')
  const [shared, setShared] = useState(false)
  const [callbacks, setCallbacks] = useState<Callback[]>([])
  // once set up, the big button turns into one quiet row
  const fwdDone = localStorage.getItem('fwdDone') === '1'
  useEffect(() => {
    authFetch('/api/me')
      .then((r) => r.json())
      .then((d) => {
        setNumber(d.number || '')
        setHasOwn(Boolean(d.has_own_number))
        setHandle(d.handle || '')
        setForwardCode(d.forward_code || '')
      })
      .catch(() => {})
    // people who dialed the shared number back — the surface that reaches
    // every user, Telegram or not
    authFetch('/api/callbacks')
      .then((r) => r.json())
      .then((d) => {
        setCallbacks(d.callbacks || [])
        if ((d.unseen || 0) > 0) {
          void authFetch('/api/callbacks/seen', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
          })
        }
      })
      .catch(() => {})
  }, [])

  function callBack(cb: Callback) {
    const num = cb.caller_number.replace(/\D/g, '')
    navigate('/call', { state: { dial: { number: num, name: fmtNumber(num) } } })
  }

  return (
    <main className="calls-home home-tab">
      {callbacks.length > 0 && (
        <div className="id-card callback-card">
          <div className="callback-head">📞 Someone called you back</div>
          {callbacks.slice(0, 5).map((cb) => (
            <div className="id-row" key={cb.id}>
              <div>
                <b>{fmtNumber(cb.caller_number)}</b>
                <small>
                  tried to reach you · {timeAgo(cb.created_at)}
                  {!cb.seen && <span className="callback-new"> • new</span>}
                </small>
              </div>
              <button className="sharebtn" onClick={() => callBack(cb)}>
                Call back
              </button>
            </div>
          ))}
        </div>
      )}
      {((hasOwn && number) || handle) && (
        <div className="id-card">
          {hasOwn && number && (
            <div className="id-row">
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
          {handle && (
            <div className="id-row">
              <div>
                <small>Sathi ID · free app-to-app calls</small>
                <b>@{handle}</b>
              </div>
              <button
                className="sharebtn"
                onClick={() => {
                  const text = `Call me FREE on SunoSathi — my Sathi ID is @${handle}. Get the app: sunosathi.com`
                  if (navigator.share) void navigator.share({ text })
                  else {
                    void navigator.clipboard?.writeText(text)
                    setHandleCopied(true)
                    setTimeout(() => setHandleCopied(false), 2000)
                  }
                }}
              >
                {handleCopied ? '✓ Copied' : 'Share'}
              </button>
            </div>
          )}
        </div>
      )}

      {forwardCode && fwdDone && (
        <button className="fwd-done" onClick={() => navigate('/setup')}>
          <span>✓ Calls set up</span>
          <span className="fwd-done-link">View</span>
        </button>
      )}

      {forwardCode && !fwdDone && (
        <button className="home-btn primary" onClick={() => navigate('/setup')}>
          <span className="emoji icon">📲</span>
          <span>
            Set up your calls
            <small>One-time, takes a minute — then your calls ring here</small>
          </span>
        </button>
      )}

      <TestCallButton />

      <button className="home-btn" onClick={() => navigate('/help')}>
        <span className="emoji icon"><HelpGlyph /></span>
        <span>
          Help
          <small>Picture guide &amp; common questions</small>
        </span>
      </button>
      <button className="home-btn" onClick={() => navigate('/support')}>
        <span className="emoji icon">💬</span>
        <span>
          Contact us · feedback
          <small>WhatsApp or message us — we reply</small>
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
