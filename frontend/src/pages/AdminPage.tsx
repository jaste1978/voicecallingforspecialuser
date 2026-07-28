import { useNavigate } from 'react-router-dom'

export default function AdminPage() {
  const navigate = useNavigate()
  return (
    <main className="home">
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
          Ringtone
          <small>Sound on incoming calls</small>
        </span>
      </button>
      <button className="home-btn" onClick={() => navigate('/captions')}>
        <span className="emoji">💬</span>
        <span>
          Caption Tester
          <small>Test live captions with this device's mic</small>
        </span>
      </button>
    </main>
  )
}
