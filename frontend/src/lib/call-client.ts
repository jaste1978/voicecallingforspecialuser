// Resilient WebSocket client for the backend call bridge (/ws/call).
// Heartbeats every 15s, auto-reconnects on death, and reconnects immediately
// when the app returns to the foreground — so incoming rings are never lost
// to a silently dead socket.

import type { LanguageKey } from './stt-client'

export interface CallEvent {
  type:
    | 'ring'
    | 'dialing'
    | 'outbound_ringing'
    | 'call_started'
    | 'transcript'
    | 'vad'
    | 'call_ended'
    | 'error'
    | 'language_set'
  from?: string
  to?: string
  callId?: string
  text?: string
  language_code?: string
  language?: string
  provider?: string
  signal?: string
  reason?: string
  message?: string
}

export interface CallClient {
  accept: (language: LanguageKey) => void
  decline: () => void
  end: () => void
  dial: (number: string, name: string, language: LanguageKey) => void
  setLanguage: (language: LanguageKey) => void
  sendPrompt: (name: 'slow_down' | 'repeat' | 'wait') => void
  sendAudio: (pcm: ArrayBuffer) => void
  close: () => void
}

const PING_EVERY_MS = 15000
const PONG_TIMEOUT_MS = 8000
const RECONNECT_DELAY_MS = 1500

export function connectCall(
  onEvent: (e: CallEvent) => void,
  onAudio: (pcm: ArrayBuffer) => void,
  onStatus: (connected: boolean) => void,
): CallClient {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  const url = `${proto}://${location.host}/ws/call`

  let ws: WebSocket | null = null
  let closedByUs = false
  let pingTimer: ReturnType<typeof setInterval> | null = null
  let pongTimer: ReturnType<typeof setTimeout> | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null

  function stopPing() {
    if (pingTimer) clearInterval(pingTimer)
    if (pongTimer) clearTimeout(pongTimer)
    pingTimer = null
    pongTimer = null
  }

  function startPing() {
    stopPing()
    pingTimer = setInterval(() => {
      if (ws?.readyState !== WebSocket.OPEN) return
      ws.send(JSON.stringify({ type: 'ping' }))
      if (pongTimer) clearTimeout(pongTimer)
      pongTimer = setTimeout(() => {
        // no pong — the socket is dead even if it looks open
        ws?.close()
      }, PONG_TIMEOUT_MS)
    }, PING_EVERY_MS)
  }

  function open() {
    if (closedByUs) return
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return
    ws = new WebSocket(url)
    ws.binaryType = 'arraybuffer'
    ws.onopen = () => {
      onStatus(true)
      startPing()
    }
    ws.onmessage = (e) => {
      if (e.data instanceof ArrayBuffer) {
        onAudio(e.data)
        return
      }
      try {
        const msg = JSON.parse(e.data as string)
        if (msg.type === 'pong') {
          if (pongTimer) clearTimeout(pongTimer)
          pongTimer = null
          return
        }
        onEvent(msg as CallEvent)
      } catch {
        /* ignore */
      }
    }
    ws.onclose = () => {
      stopPing()
      onStatus(false)
      if (!closedByUs) {
        if (reconnectTimer) clearTimeout(reconnectTimer)
        reconnectTimer = setTimeout(open, RECONNECT_DELAY_MS)
      }
    }
    ws.onerror = () => {
      try {
        ws?.close()
      } catch {
        /* ignore */
      }
    }
  }

  function onVisible() {
    if (document.visibilityState === 'visible' && ws?.readyState !== WebSocket.OPEN) {
      if (reconnectTimer) clearTimeout(reconnectTimer)
      open()
    }
  }
  document.addEventListener('visibilitychange', onVisible)
  window.addEventListener('focus', onVisible)
  window.addEventListener('online', onVisible)

  open()

  const sendJson = (obj: unknown) => {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj))
  }

  return {
    accept: (language) => sendJson({ type: 'accept', language }),
    decline: () => sendJson({ type: 'decline' }),
    end: () => sendJson({ type: 'end' }),
    dial: (number, name, language) => sendJson({ type: 'dial', number, name, language }),
    setLanguage: (language) => sendJson({ type: 'set_language', language }),
    sendPrompt: (name) => sendJson({ type: 'prompt', name }),
    sendAudio: (pcm) => {
      if (ws?.readyState === WebSocket.OPEN) ws.send(pcm)
    },
    close: () => {
      closedByUs = true
      stopPing()
      if (reconnectTimer) clearTimeout(reconnectTimer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
      window.removeEventListener('online', onVisible)
      ws?.close()
    },
  }
}
