// Who is at this phone, remembered locally.
//
// There is no login. A contributor is a device id plus whatever they chose
// to tell us, which is usually nothing. That is a deliberate trade: asking a
// deaf signer at an NGO drop-in session to create an account is how you get
// zero recordings.

const DEVICE_KEY = 'isl.device'
const SESSION_KEY = 'isl.session'
const LANG_KEY = 'isl.lang'

export interface Session {
  contributorId: string
  consentId: string
  consentVersion: string
}

export function deviceId(): string {
  let id = localStorage.getItem(DEVICE_KEY)
  if (!id) {
    id = `d_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`
    localStorage.setItem(DEVICE_KEY, id)
  }
  return id
}

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as Session
    return s.contributorId && s.consentId ? s : null
  } catch {
    return null
  }
}

export function saveSession(s: Session) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(s))
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY)
}

export type Lang = 'hi' | 'en'

export function loadLang(): Lang {
  return localStorage.getItem(LANG_KEY) === 'en' ? 'en' : 'hi'
}

export function saveLang(l: Lang) {
  localStorage.setItem(LANG_KEY, l)
}
