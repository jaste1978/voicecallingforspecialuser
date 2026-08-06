import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { authFetch, authName, clearAuth, isAdmin } from '../lib/auth'
import { BellIcon, BotIcon, CaptionsIcon, ChartIcon, InboxIcon, PhoneIncomingIcon, MicIcon, RupeeIcon } from '../components/icons'

// Bulbul speakers: the voice callers hear when you type-to-speak
const VOICES = [
  { id: '', label: 'Default (Anushka)' },
  { id: 'anushka', label: 'Anushka · female' },
  { id: 'manisha', label: 'Manisha · female' },
  { id: 'vidya', label: 'Vidya · female' },
  { id: 'arya', label: 'Arya · female' },
  { id: 'abhilash', label: 'Abhilash · male' },
  { id: 'karun', label: 'Karun · male' },
  { id: 'hitesh', label: 'Hitesh · male' },
]

export default function SettingsTab() {
  const navigate = useNavigate()
  const [voice, setVoice] = useState('')
  const [admin, setAdmin] = useState(isAdmin())

  useEffect(() => {
    authFetch('/api/prefs')
      .then((r) => r.json())
      .then((d) => setVoice(d.voice || ''))
      .catch(() => {})
    // sessions created before roles existed have no stored role — refresh
    // it from the server so the admin section appears without a re-login
    authFetch('/api/me')
      .then((r) => r.json())
      .then((d) => {
        if (d.role) {
          localStorage.setItem('authRole', d.role)
          if (d.name) localStorage.setItem('authName', d.name)
          setAdmin(d.role === 'admin')
        }
      })
      .catch(() => {})
  }, [])

  function saveVoice(v: string) {
    setVoice(v)
    void authFetch('/api/prefs', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ voice: v }),
    })
  }

  async function logout() {
    try {
      await authFetch('/api/logout', { method: 'POST' })
    } finally {
      clearAuth()
      navigate('/login', { replace: true })
    }
  }

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
      <div className="home-btn voice-row">
        <span className="emoji icon"><MicIcon size={28} /></span>
        <span style={{ flex: 1 }}>
          My voice
          <small>What callers hear when you type-to-speak</small>
        </span>
        <select
          className="lang"
          value={voice}
          onChange={(e) => saveVoice(e.target.value)}
          aria-label="Choose your voice"
        >
          {VOICES.map((v) => (
            <option key={v.id} value={v.id}>{v.label}</option>
          ))}
        </select>
      </div>
      <button className="home-btn" onClick={() => navigate('/help')}>
        <span className="emoji icon"><CaptionsIcon size={28} /></span>
        <span>
          Help &amp; FAQ
          <small>मदद — answers to common questions</small>
        </span>
      </button>
      <button className="home-btn" onClick={() => navigate('/support')}>
        <span className="emoji icon"><PhoneIncomingIcon size={28} /></span>
        <span>
          Contact us
          <small>WhatsApp, email or send a message</small>
        </span>
      </button>
      {admin && (
        <>
          <p className="settings-group">Admin</p>
          <button className="home-btn" onClick={() => navigate('/users')}>
            <span className="emoji icon"><PhoneIncomingIcon size={28} /></span>
            <span>
              Users &amp; Numbers
              <small>Onboard pilot users &amp; link their numbers</small>
            </span>
          </button>
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
          <button className="home-btn" onClick={() => navigate('/costs')}>
            <span className="emoji icon"><RupeeIcon size={28} /></span>
            <span>
              Costs
              <small>Per-call Sarvam &amp; Vobiz spend, editable rates</small>
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
      <button className="logout-btn" onClick={() => void logout()}>
        Log out{authName() ? ` · ${authName()}` : ''}
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
