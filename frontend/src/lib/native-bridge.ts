// Bridge to the Expo/React Native shell when the web app runs inside it.

declare global {
  interface Window {
    ReactNativeWebView?: { postMessage: (msg: string) => void }
  }
}

export function notifyNative(msg: 'ring' | 'ring_stop') {
  window.ReactNativeWebView?.postMessage(msg)
}
