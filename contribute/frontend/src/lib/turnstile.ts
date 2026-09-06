// Cloudflare Turnstile, only when it is configured.
//
// The widget is set to interaction-only so an honest contributor sees
// nothing at all; it appears only when Cloudflare wants a human check.
// Without VITE_TURNSTILE_SITEKEY every function here is a no-op, which is
// what makes the record loop testable on a laptop and on a phone over the
// LAN, where a sitekey scoped to *.sunosathi.com could never validate.

const SITEKEY = import.meta.env.VITE_TURNSTILE_SITEKEY as string | undefined
const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

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

export const enabled = () => Boolean(SITEKEY)

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

export async function mount(host: HTMLElement): Promise<void> {
  if (!SITEKEY || widgetId) return
  await loadScript()
  const api = window.turnstile
  if (!api) return
  widgetId = api.render(host, {
    sitekey: SITEKEY,
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
  if (!SITEKEY || !widgetId || !window.turnstile) return Promise.resolve('')
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
