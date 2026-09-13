// Cloudflare Turnstile, only when it is configured.
//
// The widget is set to interaction-only so an honest contributor sees
// nothing at all; it appears only when Cloudflare wants a human check.
// With no sitekey configured every function here is a no-op, which is what
// makes the record loop testable on a laptop and on a phone over the LAN,
// where a sitekey scoped to *.sunosathi.com could never validate.

// Build-time value is only a local-development convenience; in a deployed
// container the server hands it over at runtime via configure().
let sitekey = (import.meta.env.VITE_TURNSTILE_SITEKEY as string | undefined) ?? ''
const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

/** Called once on boot with whatever /api/health reports. */
export function configure(key: string) {
  if (key) sitekey = key
}

interface TurnstileApi {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string
  reset: (id: string) => void
  remove: (id: string) => void
}

declare global {
  interface Window { turnstile?: TurnstileApi }
}

let scriptPromise: Promise<void> | null = null
let widgetId: string | null = null
let pending: ((token: string) => void) | null = null

export const enabled = () => Boolean(sitekey)

function loadScript(): Promise<void> {
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const el = document.createElement('script')
      el.src = SCRIPT
      el.async = true
      el.onload = () => resolve()
      el.onerror = () => reject(new Error('turnstile script blocked'))
      document.head.appendChild(el)
    })
  }
  return scriptPromise
}

let mountedIn: HTMLElement | null = null

export async function mount(host: HTMLElement): Promise<void> {
  if (!sitekey) return
  if (widgetId && mountedIn === host && host.isConnected) return
  await loadScript()
  const api = window.turnstile
  if (!api) return
  // One widget at a time: moving screens (auth form ↔ app root) re-renders
  // it in the new host, so a visible challenge always sits where the person
  // is actually looking.
  if (widgetId) {
    try { api.remove(widgetId) } catch { /* its DOM may already be gone */ }
    widgetId = null
  }
  mountedIn = host
  widgetId = api.render(host, {
    sitekey,
    appearance: 'interaction-only',
    callback: (token: string) => {
      const resolve = pending
      pending = null
      resolve?.(token)
    },
  })
}

/**
 * A fresh token per submit — Turnstile tokens are single-use, and a
 * contributor recording twenty phrases submits twenty times. Resolves to ''
 * rather than rejecting if Cloudflare is unreachable; the server fails open
 * for the same reason, and a signer who showed up should not be turned away
 * by someone else's outage.
 */
export function token(timeoutMs = 8000): Promise<string> {
  if (!sitekey || !widgetId || !window.turnstile) return Promise.resolve('')
  if (!mountedIn?.isConnected) return Promise.resolve('') // widget's DOM is gone
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending = null
      resolve('')
    }, timeoutMs)
    pending = (t: string) => {
      clearTimeout(timer)
      resolve(t)
    }
    window.turnstile!.reset(widgetId!)
  })
}
