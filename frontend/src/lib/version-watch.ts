// Inside the native shells (Expo Go WebView, Android APK) the page lives for
// days and there is no pull-to-refresh — a stale bundle can linger forever.
// Watch the server version and reload ourselves when we're outdated, but
// never while a call is ringing or active.

declare global {
  interface Window {
    __callActive?: boolean
  }
}

const CHECK_MS = 5 * 60 * 1000
let started = false
let reloading = false

async function check() {
  if (reloading || window.__callActive) return
  try {
    const r = await fetch('/api/health', { cache: 'no-store' })
    const d = await r.json()
    if (d.version && d.version !== __APP_VERSION__) {
      // reload once per server version — a deploy race must not loop us
      if (sessionStorage.getItem('vw-reloaded-for') === d.version) return
      sessionStorage.setItem('vw-reloaded-for', d.version)
      reloading = true
      location.reload()
    }
  } catch {
    /* offline — try again later */
  }
}

export function startVersionWatch() {
  if (started) return
  started = true
  setInterval(() => void check(), CHECK_MS)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void check()
  })
  window.addEventListener('focus', () => void check())
  setTimeout(() => void check(), 4000)
}
