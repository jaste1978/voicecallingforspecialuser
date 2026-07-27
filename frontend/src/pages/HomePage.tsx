import { useNavigate } from 'react-router-dom'

export default function HomePage() {
  const navigate = useNavigate()
  return (
    <main className="home">
      <button className="home-btn primary" onClick={() => navigate('/call')}>
        <span className="emoji">📞</span>
        <span>
          Calls
          <small>Answer incoming calls with live captions</small>
        </span>
      </button>
      <button className="home-btn" onClick={() => navigate('/contacts')}>
        <span className="emoji">📱</span>
        <span>
          New Call
          <small>Call your contacts or any number</small>
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
