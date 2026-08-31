// Thin wrapper over gtag (loaded in index.html). Never send PII —
// no emails, names, numbers or caption text in events.

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void
  }
}

export function track(event: string, params?: Record<string, string | number>) {
  try {
    window.gtag?.('event', event, params ?? {})
  } catch {
    /* analytics must never break the app */
  }
}

export function trackPage(path: string) {
  try {
    window.gtag?.('event', 'page_view', { page_path: path })
  } catch {
    /* ignore */
  }
}
