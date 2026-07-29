import { useNavigate } from 'react-router-dom'
import { authFetch, authName, clearAuth, isAdmin } from '../lib/auth'
import { BellIcon, BotIcon, CaptionsIcon, ChartIcon, InboxIcon } from '../components/icons'

export default function SettingsTab() {
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
    <main className="home settings-list">
      <button className="home-btn" onClick={() => navigate('/ringtone')}>
        <span className="emoji icon"><BellIcon size={28} /></span>
        <span>
          Ring & Vibration
          <small>Ringtone &amp; vibration alerts</small>
        </span>
      </button>
      <button className="home-btn" onClick={() => navigate('/captions')}>
        <span className="emoji icon"><CaptionsIcon size={28} /></span>
        <span>
          Caption Tester
          <small>Test live captions with this device's mic</small>
        </span>
      </button>
      {admin && (
        <>
          <p className="settings-group">Admin</p>
          <button className="home-btn" onClick={() => navigate('/models')}>
            <span className="emoji icon"><BotIcon size={28} /></span>
            <span>
              AI Models
              <small>Choose which model powers captions &amp; voice</small>
            </span>
          </button>
          <button className="home-btn" onClick={() => navigate('/monitor')}>
            <span className="emoji icon"><ChartIcon size={28} /></span>
            <span>
              Call Monitor
              <small>Live status &amp; per-call health checks</small>
            </span>
          </button>
          <button className="home-btn" onClick={() => navigate('/waitlist')}>
            <span className="emoji icon"><InboxIcon size={28} /></span>
            <span>
              Pilot Waitlist
              <small>Signups from sunosathi.com</small>
            </span>
          </button>
        </>
      )}
      <button className="historylink" onClick={() => void logout()}>
        Log out{authName() ? ` (${authName()})` : ''}
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
