import { useEffect, useState } from 'react'
import { authFetch } from '../lib/auth'
import { fmtNumber } from '../lib/format'
import { avatarColor } from '../components/Avatar'
import { TrashIcon } from '../components/icons'

interface MappedNumber {
  id: number
  number: string
  kind: string
}

interface User {
  id: number
  email: string
  name: string
  role: string
  status?: string
  requested_number?: string | null
  numbers: MappedNumber[]
}

interface MeInfo {
  did: string
  forward_code: string
}

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([])
  const [me, setMe] = useState<MeInfo | null>(null)
  const [error, setError] = useState('')
  // create-user form
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [number, setNumber] = useState('')
  const [busy, setBusy] = useState(false)
  // remember passwords created this session so the setup message can include them
  const [createdPasswords, setCreatedPasswords] = useState<Record<number, string>>({})
  const [copiedFor, setCopiedFor] = useState<number | null>(null)
  // per-user add-number inputs
  const [numInputs, setNumInputs] = useState<Record<number, string>>({})

  function load() {
    authFetch('/api/users')
      .then((r) => r.json())
      .then((d) => setUsers(d.users ?? []))
      .catch(() => {})
    authFetch('/api/me')
      .then((r) => r.json())
      .then((d) => setMe({ did: d.did, forward_code: d.forward_code }))
      .catch(() => {})
  }

  useEffect(load, [])

  function genPassword() {
    const words = ['Suno', 'Sathi', 'Awaaz', 'Baat', 'Dost', 'Seva']
    const w = () => words[Math.floor(Math.random() * words.length)]
    return `${w()}${Math.floor(1000 + Math.random() * 9000)}${w()}`
  }

  async function createUser() {
    setError('')
    setBusy(true)
    try {
      const resp = await authFetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), password }),
      })
      if (!resp.ok) {
        setError('Could not create user — email may already exist, or password under 8 characters')
        return
      }
      const d = await resp.json()
      setCreatedPasswords((p) => ({ ...p, [d.id]: password }))
      if (number.trim()) {
        await authFetch('/api/numbers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_id: d.id, number: number.trim() }),
        })
      }
      setName('')
      setEmail('')
      setPassword('')
      setNumber('')
      load()
    } finally {
      setBusy(false)
    }
  }

  async function addNumber(userId: number) {
    const value = (numInputs[userId] || '').trim()
    if (!value) return
    const resp = await authFetch('/api/numbers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, number: value }),
    })
    if (!resp.ok) {
      setError('Number rejected — needs 10 digits, and one number can only map to one user')
      return
    }
    setError('')
    setNumInputs((p) => ({ ...p, [userId]: '' }))
    load()
  }

  async function removeNumber(id: number) {
    await authFetch(`/api/numbers/${id}`, { method: 'DELETE' })
    load()
  }

  const [resetPw, setResetPw] = useState<Record<number, string>>({})

  async function resetPassword(userId: number) {
    const resp = await authFetch(`/api/users/${userId}/reset-password`, { method: 'POST' })
    if (resp.ok) {
      const d = await resp.json()
      setResetPw((p) => ({ ...p, [userId]: d.temp_password }))
      setCreatedPasswords((p) => ({ ...p, [userId]: d.temp_password }))
    } else {
      setError('Could not reset password')
    }
  }

  async function decide(userId: number, action: 'approve' | 'reject') {
    const resp = await authFetch(`/api/users/${userId}/${action}`, { method: 'POST' })
    if (!resp.ok) setError(`Could not ${action} — try again`)
    load()
  }

  function copySetup(u: User) {
    const pw = createdPasswords[u.id]
    const lines = [
      `Namaste ${u.name || ''}! Your SunoSathi is ready 🙏`,
      '',
      '1) Open https://app.sunosathi.com and sign in:',
      `   Email: ${u.email}`,
      pw ? `   Password: ${pw}` : '   Password: (shared separately)',
      '',
      `2) On your phone, dial ${me?.forward_code ?? ''} once.`,
      '   This forwards your calls to SunoSathi.',
      '',
      '3) Done! When someone calls your number, read their words',
      '   live on screen and reply with your own voice.',
      '',
      `To stop forwarding anytime, dial ##21#`,
    ]
    void navigator.clipboard?.writeText(lines.join('\n'))
    setCopiedFor(u.id)
    setTimeout(() => setCopiedFor(null), 2000)
  }

  const pending = users.filter((u) => u.status === 'pending')
  const rest = users.filter((u) => u.status !== 'pending')

  return (
    <main className="settings-page">
      {pending.length > 0 && (
        <section className="setting-block" style={{ borderColor: 'var(--accent)' }}>
          <h3>⏳ Waiting for approval ({pending.length})</h3>
          <p className="idle-hint">
            Signed up from the app. Approving activates the account and links
            their number so calls can reach them.
          </p>
          {pending.map((u) => (
            <div className="configured-row" key={u.id}>
              <span>
                <strong>{u.name || u.email}</strong>
                <small>
                  {u.email}
                  {u.requested_number ? ` · ${fmtNumber(u.requested_number)}` : ''}
                </small>
              </span>
              <span style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                <button className="promptbtn" onClick={() => void decide(u.id, 'reject')}>
                  Reject
                </button>
                <button className="bigbtn start" style={{ minHeight: 40, padding: '0 16px', flex: '0 0 auto' }}
                  onClick={() => void decide(u.id, 'approve')}>
                  Approve
                </button>
              </span>
            </div>
          ))}
        </section>
      )}

      <section className="setting-block">
        <h3>Add a pilot user</h3>
        <p className="idle-hint">
          Creates their login and links the mobile number they will forward to
          SunoSathi ({me ? me.did : '…'}).
        </p>
        <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
          <input className="dialinput" placeholder="Name" value={name}
            onChange={(e) => setName(e.target.value)} />
          <input className="dialinput" type="email" placeholder="Email" value={email}
            onChange={(e) => setEmail(e.target.value)} />
          <div style={{ display: 'flex', gap: 8 }}>
            <input className="dialinput" style={{ flex: 1 }} placeholder="Password (min 8 chars)"
              value={password} onChange={(e) => setPassword(e.target.value)} />
            <button className="promptbtn" style={{ flex: '0 0 auto' }}
              onClick={() => setPassword(genPassword())}>
              Generate
            </button>
          </div>
          <input className="dialinput" type="tel" inputMode="tel"
            placeholder="Their mobile number (optional)" value={number}
            onChange={(e) => setNumber(e.target.value)} />
          {error && <p className="status-line error">{error}</p>}
          <button className="bigbtn start" disabled={busy || !email.trim() || password.length < 8}
            onClick={() => void createUser()}>
            Create user
          </button>
        </div>
      </section>

      {rest.map((u) => (
        <section className="setting-block" key={u.id}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span className="contact-avatar named" style={{ background: avatarColor(u.name || u.email) }}>
              {(u.name || u.email).trim().charAt(0).toUpperCase()}
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span className="contact-name">
                {u.name || u.email}
                {u.role === 'admin' && ' 👑'}
                {u.status === 'rejected' && ' · ❌ rejected'}
              </span>
              <span className="contact-number">{u.email}</span>
            </span>
          </div>

          <div className="configured-list">
            {u.numbers.length === 0 && (
              <p className="idle-hint" style={{ textAlign: 'left' }}>
                No number linked — calls can't reach this user yet.
              </p>
            )}
            {u.numbers.map((n) => (
              <div className="configured-row" key={n.id}>
                <span>
                  {fmtNumber(n.number)}
                  <small>{n.kind === 'did' ? 'dedicated SunoSathi number' : 'forwards to SunoSathi'}</small>
                </span>
                <button className="iconbtn" aria-label="Remove number"
                  onClick={() => void removeNumber(n.id)}>
                  <TrashIcon size={18} />
                </button>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 8 }}>
              <input className="dialinput" style={{ flex: 1 }} type="tel" inputMode="tel"
                placeholder="Link a mobile number"
                value={numInputs[u.id] || ''}
                onChange={(e) => setNumInputs((p) => ({ ...p, [u.id]: e.target.value }))} />
              <button className="promptbtn" style={{ flex: '0 0 auto' }}
                disabled={!(numInputs[u.id] || '').trim()}
                onClick={() => void addNumber(u.id)}>
                Link
              </button>
            </div>
          </div>

          {resetPw[u.id] && (
            <p className="status-line">
              🔑 Temporary password: <strong>{resetPw[u.id]}</strong> — WhatsApp it
              to them; other devices are signed out.
            </p>
          )}
          <button className="historylink" onClick={() => void resetPassword(u.id)}>
            Reset password
          </button>
          <button className="historylink" onClick={() => copySetup(u)}>
            {copiedFor === u.id ? '✓ Copied — paste into WhatsApp' : 'Copy setup message'}
          </button>
        </section>
      ))}
    </main>
  )
}
