import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { authFetch } from '../lib/auth'
import TestCallButton from '../components/TestCallButton'

export default function SetupPage() {
  const navigate = useNavigate()
  const [forwardCode, setForwardCode] = useState('')
  const [codeCopied, setCodeCopied] = useState(false)

  useEffect(() => {
    authFetch('/api/me')
      .then((r) => r.json())
      .then((d) => setForwardCode(d.forward_code || ''))
      .catch(() => {})
  }, [])

  return (
    <main className="calls-home home-tab">
      <div className="setup-card">
        <p className="howto-title">1 · Dial this code once</p>
        <p className="setup-text">From your phone's dialer — your calls then ring in SunoSathi:</p>
        <div className="forward-code-row">
          <code className="forward-code">{forwardCode || '…'}</code>
          <button
            className="promptbtn"
            disabled={!forwardCode}
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

      <p className="howto-title setup-step">2 · Check it works</p>
      <TestCallButton />

      <button
        className="fwd-confirm"
        onClick={() => {
          localStorage.setItem('fwdDone', '1')
          navigate('/')
        }}
      >
        ✓ Done
      </button>
    </main>
  )
}
