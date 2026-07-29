import { useNavigate } from 'react-router-dom'
import { authFetch, authName, clearAuth, isAdmin } from '../lib/auth'

export default function AdminPage() {
  const navigate = useNavigate()

  async function logout() {
    try {
      await authFetch('/api/logout', { method: 'POST' })
    } finally {
      clearAuth()
      navigate('/login', { replace: true })
    }
  }

  const admin = isAdmin()

  return (
    <main className="home">
      {admin && (
        <>
          <button className="home-btn" onClick={() => navigate('/settings')}>
            <span className="emoji">🤖</span>
            <span>
              AI Models
              <small>Choose which model powers captions &amp; voice</small>
            </span>
          </button>
          <button className="home-btn" onClick={() => navigate('/waitlist')}>
            <span className="emoji">📥</span>
            <span>
              Pilot Waitlist
              <small>Signups from sunosathi.com</small>
            </span>
          </button>
          <button className="home-btn" onClick={() => navigate('/monitor')}>
            <span className="emoji">📊</span>
            <span>
              Call Monitor
              <small>Live status &amp; per-call health checks</small>
            </span>
          </button>
        </>
      )}
      <button className="home-btn" onClick={() => navigate('/history')}>
        <span className="emoji">🕓</span>
        <span>
          Call History
          <small>Transcripts, recordings &amp; diagnostics</small>
        </span>
      </button>
      <button className="home-btn" onClick={() => navigate('/ringtone')}>
        <span className="emoji">🔔</span>
        <span>
          Ring & Vibration
          <small>Ringtone &amp; vibration alerts</small>
        </span>
      </button>
      <button className="home-btn" onClick={() => navigate('/captions')}>
        <span className="emoji">💬</span>
        <span>
          Caption Tester
          <small>Test live captions with this device's mic</small>
        </span>
      </button>
      <button className="historylink" onClick={() => void logout()}>
        Log out{authName() ? ` (${authName()})` : ''}
      </button>
    </main>
  )
}
