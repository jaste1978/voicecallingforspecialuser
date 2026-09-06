// Per-browser preferences.
//
// Identity used to live here, as a device id. It does not any more: an
// account is a session cookie the browser holds and script cannot read, so
// there is nothing about who you are left to keep in localStorage. What is
// left is the one thing that genuinely belongs to this device — which
// language the person reads.

const LANG_KEY = 'isl.lang'

export type Lang = 'hi' | 'en'

export function loadLang(): Lang {
  try {
    return localStorage.getItem(LANG_KEY) === 'en' ? 'en' : 'hi'
  } catch {
    return 'hi' // private mode, or storage blocked; a default is fine here
  }
}

export function saveLang(l: Lang) {
  try {
    localStorage.setItem(LANG_KEY, l)
  } catch { /* the choice just will not persist; nothing else breaks */ }
}
