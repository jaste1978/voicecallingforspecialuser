// Register or sign in.
//
// The platform is gated during the pilot: anyone can ask, an admin decides
// who records. Kept to the four fields an admin actually needs to make that
// decision — a name, a way to reach you, a password, and who you are.

import { useState } from 'react'
import { login, register } from '../lib/api'
import * as turnstile from '../lib/turnstile'
import type { Auth as AuthResult } from '../lib/api'
import type { Lang } from '../lib/device'

const T = {
  hi: {
    joinTitle: 'खाता बनाएँ',
    joinLead: 'अभी यह प्लेटफ़ॉर्म बंद है — खाता बनाने के बाद हम आपको मंज़ूरी देंगे, फिर आप रिकॉर्ड कर सकेंगे।',
    signTitle: 'साइन इन करें',
    name: 'आपका नाम',
    identifier: 'फ़ोन नंबर या ईमेल',
    identifierHint: 'इसी से आप साइन इन करेंगे।',
    password: 'पासवर्ड',
    passwordHint: 'कम से कम 8 अक्षर।',
    note: 'आप ISL से कैसे जुड़े हैं? (मर्ज़ी से)',
    notePlaceholder: 'जैसे: मैं बहरा हूँ / दुभाषिया हूँ / NGO में काम करता हूँ',
    noteHint: 'इससे मंज़ूरी जल्दी मिलती है।',
    join: 'खाता बनाएँ',
    sign: 'साइन इन',
    toSign: 'पहले से खाता है? साइन इन करें',
    toJoin: 'नया खाता बनाएँ',
    show: 'दिखाएँ', hide: 'छिपाएँ',
    working: 'रुकिए…',
  },
  en: {
    joinTitle: 'Create an account',
    joinLead: 'The platform is invite-only for now — create an account and we will approve you, then you can record.',
    signTitle: 'Sign in',
    name: 'Your name',
    identifier: 'Phone number or email',
    identifierHint: 'This is what you will sign in with.',
    password: 'Password',
    passwordHint: 'At least 8 characters.',
    note: 'How are you connected to ISL? (optional)',
    notePlaceholder: 'e.g. I am deaf / I interpret / I work at an NGO',
    noteHint: 'It helps us approve you faster.',
    join: 'Create account',
    sign: 'Sign in',
    toSign: 'Already have an account? Sign in',
    toJoin: 'Create a new account',
    show: 'Show', hide: 'Hide',
    working: 'One moment…',
  },
} as const

interface Props {
  lang: Lang
  startOn?: 'join' | 'sign'
  onDone: (result: AuthResult) => void
  onBack: () => void
}

export default function Auth({ lang, startOn = 'join', onDone, onBack }: Props) {
  const t = T[lang]
  const [mode, setMode] = useState<'join' | 'sign'>(startOn)
  const [name, setName] = useState('')
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [note, setNote] = useState('')
  const [reveal, setReveal] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const joining = mode === 'join'
  const ready = identifier.trim().length > 2 && password.length >= 8
    && (!joining || name.trim().length >= 2)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!ready || busy) return
    setBusy(true)
    setError('')
    try {
      const token = joining ? await turnstile.token() : ''
      onDone(joining
        ? await register({ name: name.trim(), identifier: identifier.trim(), password,
                           note: note.trim(), ...(token ? { turnstile: token } : {}) })
        : await login({ identifier: identifier.trim(), password }))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  return (
    <div className="pane auth">
      <h1>{joining ? t.joinTitle : t.signTitle}</h1>
      {joining && <p className="lead">{t.joinLead}</p>}

      <form className="fields" onSubmit={submit}>
        {joining && (
          <label>
            <span>{t.name}</span>
            <input value={name} onChange={(e) => setName(e.target.value)}
                   autoComplete="name" maxLength={80} required />
          </label>
        )}

        <label>
          <span>{t.identifier}</span>
          <input value={identifier} onChange={(e) => setIdentifier(e.target.value)}
                 autoComplete="username" inputMode="email" maxLength={120} required />
          {joining && <small>{t.identifierHint}</small>}
        </label>

        <label>
          <span>{t.password}</span>
          <span className="with-action">
            <input type={reveal ? 'text' : 'password'} value={password}
                   onChange={(e) => setPassword(e.target.value)}
                   autoComplete={joining ? 'new-password' : 'current-password'}
                   minLength={8} required />
            <button type="button" className="link" onClick={() => setReveal((v) => !v)}>
              {reveal ? t.hide : t.show}
            </button>
          </span>
          {joining && <small>{t.passwordHint}</small>}
        </label>

        {joining && (
          <label>
            <span>{t.note}</span>
            <textarea value={note} onChange={(e) => setNote(e.target.value)}
                      placeholder={t.notePlaceholder} maxLength={500} rows={3} />
            <small>{t.noteHint}</small>
          </label>
        )}

        {error && <p className="err">{error}</p>}

        <div className="controls">
          <button type="button" className="btn ghost" onClick={onBack} disabled={busy}>
            ←
          </button>
          <button type="submit" className="btn primary" disabled={!ready || busy}>
            {busy ? t.working : joining ? t.join : t.sign}
          </button>
        </div>
      </form>

      <button className="link switch" onClick={() => { setError(''); setMode(joining ? 'sign' : 'join') }}>
        {joining ? t.toSign : t.toJoin}
      </button>
    </div>
  )
}
