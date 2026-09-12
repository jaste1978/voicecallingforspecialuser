import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { authFetch, authName, clearAuth, isAdmin } from '../lib/auth'
import { pictureCaptionsEnabled, setPictureCaptions } from '../lib/pictureCaptions'
import { BellIcon, BotIcon, CaptionsIcon, ChartIcon, InboxIcon, PhoneIncomingIcon, MicIcon, RupeeIcon } from '../components/icons'

// Bulbul v3 speakers: the voice callers hear when you type-to-speak
// (old v2 ids users saved — anushka, manisha… — are mapped server-side)
const VOICES = [
  { id: '', label: 'Default (Priya)' },
  { id: 'priya', label: 'Priya · female' },
  { id: 'neha', label: 'Neha · female' },
  { id: 'pooja', label: 'Pooja · female' },
  { id: 'simran', label: 'Simran · female' },
  { id: 'rahul', label: 'Rahul · male' },
  { id: 'aditya', label: 'Aditya · male' },
  { id: 'rohan', label: 'Rohan · male' },
]

export default function SettingsTab() {
  const navigate = useNavigate()
  const [voice, setVoice] = useState('')
  const [admin, setAdmin] = useState(isAdmin())
  const [picMode, setPicMode] = useState(pictureCaptionsEnabled())
  const [tgLinked, setTgLinked] = useState(false)

  useEffect(() => {
    authFetch('/api/telegram/link')
      .then((r) => r.json())
      .then((d) => setTgLinked(!!d.linked))
      .catch(() => {})
  }, [])

  const [tgCode, setTgCode] = useState('')
  const [tgCopied, setTgCopied] = useState(false)

  async function openTelegramLink() {
    try {
      const d = await (await authFetch('/api/telegram/link')).json()
      if (!d.url) return
      // show the always-works manual path; old app shells can't reliably
      // hand https://t.me over to the Telegram app
      const code = new URL(d.url).searchParams.get('start') || ''
      setTgCode(code)
      // still try the direct route — works in browsers and new shells
      const w = window.open(d.url, '_blank')
      if (!w && !navigator.userAgent.includes('wv')) {
        // plain browser with popups blocked
        window.location.href = d.url
      }
    } catch { /* ignore */ }
  }

  function copyStartCommand() {
    void navigator.clipboard?.writeText(`/start ${tgCode}`)
    setTgCopied(true)
    setTimeout(() => setTgCopied(false), 2500)
  }

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

  const [pwOpen, setPwOpen] = useState(false)
  const [pwOld, setPwOld] = useState('')
  const [pwNew, setPwNew] = useState('')
  const [pwMsg, setPwMsg] = useState('')

  async function changePassword() {
    setPwMsg('')
    const resp = await authFetch('/api/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ old: pwOld, new: pwNew }),
    })
    if (resp.ok) {
      setPwMsg('✓ Password changed · पासवर्ड बदल गया')
      setPwOld('')
      setPwNew('')
      setTimeout(() => { setPwOpen(false); setPwMsg('') }, 2500)
    } else if (resp.status === 403) {
      setPwMsg('Current password is wrong')
    } else {
      setPwMsg('New password must be at least 8 characters')
    }
  }

  const [delOpen, setDelOpen] = useState(false)
  const [delPw, setDelPw] = useState('')
  const [delMsg, setDelMsg] = useState('')
  const [delBusy, setDelBusy] = useState(false)

  async function deleteAccount() {
    setDelMsg('')
    setDelBusy(true)
    try {
      const resp = await authFetch('/api/me', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: delPw }),
      })
      if (resp.ok) {
        clearAuth()
        navigate('/start', { replace: true })
      } else if (resp.status === 403) {
        setDelMsg('Password is wrong · पासवर्ड गलत है')
      } else {
        setDelMsg('Could not delete the account — contact us from Support')
      }
    } catch {
      setDelMsg('Could not reach the server — try again')
    } finally {
      setDelBusy(false)
    }
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
      <button className="home-btn"
        onClick={() => { const v = !picMode; setPicMode(v); setPictureCaptions(v) }}>
        <span className="emoji icon">🖼️</span>
        <span style={{ flex: 1 }}>
          Picture captions · चित्र मोड
          <small>Show the caller's words as pictures during calls</small>
        </span>
        <span style={{ fontSize: 15, fontWeight: 700, color: picMode ? 'var(--ok)' : 'var(--dim)' }}>
          {picMode ? 'ON' : 'OFF'}
        </span>
      </button>
      <button className="home-btn" onClick={() => void openTelegramLink()}>
        <span className="emoji icon">✈️</span>
        <span style={{ flex: 1 }}>
          Telegram alerts · टेलीग्राम
          <small>Missed calls reach you on Telegram, even with the app closed</small>
        </span>
        <span style={{ fontSize: 15, fontWeight: 700, color: tgLinked ? 'var(--ok)' : 'var(--dim)' }}>
          {tgLinked ? '✓' : 'Link'}
        </span>
      </button>
      {tgCode && !tgLinked && (
        <div className="setting-block">
          <h3>Telegram से जोड़िए · Link Telegram</h3>
          <p className="idle-hint" style={{ textAlign: 'left' }}>
            1️⃣ <strong>Telegram</strong> app खोलिए<br />
            2️⃣ Search: <strong>@sunosathibot</strong><br />
            3️⃣ यह message भेजिए · send this message:
          </p>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <code style={{ flex: 1, background: 'var(--surface)', borderRadius: 12,
              padding: '12px 14px', fontSize: 15, wordBreak: 'break-all' }}>
              /start {tgCode}
            </code>
            <button className="promptbtn" style={{ flex: '0 0 auto' }}
              onClick={copyStartCommand}>
              {tgCopied ? '✓ Copied' : 'Copy'}
            </button>
          </div>
          <p className="idle-hint" style={{ textAlign: 'left', marginTop: 8 }}>
            Bot का ✅ reply आते ही missed calls की सूचना Telegram पर मिलेगी।
          </p>
        </div>
      )}
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
      {!pwOpen ? (
        <button className="home-btn" onClick={() => setPwOpen(true)}>
          <span className="emoji icon">🔑</span>
          <span>
            Change password · पासवर्ड बदलें
            <small>Set a new sign-in password for your account</small>
          </span>
        </button>
      ) : (
        <div className="setting-block">
          <h3>Change password · पासवर्ड बदलें</h3>
          <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>
            <input className="dialinput" type="password" placeholder="Current password"
              autoComplete="current-password"
              value={pwOld} onChange={(e) => setPwOld(e.target.value)} />
            <input className="dialinput" type="password" placeholder="New password (8+ characters)"
              autoComplete="new-password"
              value={pwNew} onChange={(e) => setPwNew(e.target.value)} />
            {pwMsg && <p className="status-line">{pwMsg}</p>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="promptbtn" onClick={() => { setPwOpen(false); setPwMsg('') }}>
                Cancel
              </button>
              <button className="bigbtn start" style={{ minHeight: 46 }}
                disabled={!pwOld || pwNew.length < 8}
                onClick={() => void changePassword()}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {!admin && (!delOpen ? (
        <button className="home-btn" onClick={() => setDelOpen(true)}>
          <span className="emoji icon">🗑</span>
          <span>
            Delete my account · खाता हटाएँ
            <small>Permanently removes your account, numbers and call history</small>
          </span>
        </button>
      ) : (
        <div className="setting-block" style={{ borderColor: '#c0392b' }}>
          <h3>Delete my account · खाता हटाएँ</h3>
          <p className="idle-hint" style={{ textAlign: 'left' }}>
            This permanently deletes your account, linked numbers, contacts and
            call history. It cannot be undone. Remember to dial <strong>##21#</strong>{' '}
            afterwards to stop call forwarding.
          </p>
          <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>
            <input className="dialinput" type="password"
              placeholder="Confirm with your password"
              autoComplete="current-password"
              value={delPw} onChange={(e) => setDelPw(e.target.value)} />
            {delMsg && <p className="status-line error">{delMsg}</p>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="promptbtn" onClick={() => { setDelOpen(false); setDelMsg(''); setDelPw('') }}>
                Cancel
              </button>
              <button className="bigbtn start" style={{ minHeight: 46, background: '#c0392b' }}
                disabled={delBusy || !delPw}
                onClick={() => void deleteAccount()}>
                {delBusy ? 'Deleting…' : 'Delete forever'}
              </button>
            </div>
          </div>
        </div>
      ))}

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
