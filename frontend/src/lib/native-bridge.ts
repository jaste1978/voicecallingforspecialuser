// Bridge to the Expo/React Native shell when the web app runs inside it.

declare global {
  interface Window {
    ReactNativeWebView?: { postMessage: (msg: string) => void }
  }
}

export type NativeMsg =
  | 'ring'
  | 'ring_stop'
  | 'haptic:connect'
  | 'haptic:speech'
  | 'haptic:caption'
  | 'haptic:end'

// short web-vibration fallbacks (Android browsers; iOS web ignores)
const WEB_VIBRATE: Partial<Record<NativeMsg, number | number[]>> = {
  'haptic:connect': [40, 60, 40],
  'haptic:speech': 60,
  'haptic:caption': 15,
  'haptic:end': [80, 80, 80],
}

export function notifyNative(msg: NativeMsg) {
  if (window.ReactNativeWebView) {
    window.ReactNativeWebView.postMessage(msg)
    return
  }
  const pattern = WEB_VIBRATE[msg]
  if (pattern) navigator.vibrate?.(pattern)
}

// Hand the session token to the native shell so its background ring
// service can hold its own /ws/ring connection (rings with the app
// closed or the phone locked). Empty token = logged out, service stops.
export function syncNativeAuth(token: string | null) {
  window.ReactNativeWebView?.postMessage(`auth:${token ?? ''}`)
}
