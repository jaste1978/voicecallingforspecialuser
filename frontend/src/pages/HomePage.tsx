import { useNavigate } from 'react-router-dom'

export default function HomePage() {
  const navigate = useNavigate()
  return (
    <main className="home">
      <button className="home-btn primary" onClick={() => navigate('/captions')}>
        <span className="emoji">💬</span>
        <span>
          Live Captions
          <small>See what people around you are saying</small>
        </span>
      </button>
      <button className="home-btn" onClick={() => navigate('/call')}>
        <span className="emoji">📞</span>
        <span>
          Calls
          <small>Answer phone calls with live captions</small>
        </span>
      </button>
      <button className="home-btn" onClick={() => navigate('/alerts')}>
        <span className="emoji">🔔</span>
        <span>
          Sound Alerts
          <small>Get alerted to doorbells, alarms &amp; more</small>
        </span>
      </button>
      <button className="home-btn" onClick={() => navigate('/history')}>
        <span className="emoji">🕓</span>
        <span>
          Call History
          <small>Past calls with full transcripts</small>
        </span>
      </button>
      <p className="version-line">
        v{__APP_VERSION__} · deployed{' '}
        {new Date(__BUILD_TIME__).toLocaleString([], {
          day: '2-digit',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
        })}
      </p>
    </main>
  )
}
