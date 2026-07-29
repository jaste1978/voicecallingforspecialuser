import { wsAuth } from './auth'
// WebSocket client for the backend STT relay (/ws/stt)

export type LanguageKey = 'hi' | 'gu' | 'en' | 'hinglish' | 'auto'

export interface SttEvent {
  type: 'ready' | 'transcript' | 'vad' | 'error'
  text?: string
  language_code?: string
  signal?: 'START_SPEECH' | 'END_SPEECH' | string
  message?: string
  language?: string
}

export interface SttClient {
  sendAudio: (pcm: ArrayBuffer) => void
  flush: () => void
  close: () => void
}

export function connectStt(
  language: LanguageKey,
  onEvent: (e: SttEvent) => void,
  onClose: () => void,
): SttClient {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  const ws = new WebSocket(wsAuth(`${proto}://${location.host}/ws/stt`))
  ws.binaryType = 'arraybuffer'

  const pending: ArrayBuffer[] = []
  let ready = false

  ws.onopen = () => {
    ws.send(JSON.stringify({ language, sample_rate: 16000 }))
    ready = true
    for (const chunk of pending) ws.send(chunk)
    pending.length = 0
  }
  ws.onmessage = (e) => {
    try {
      onEvent(JSON.parse(e.data as string) as SttEvent)
    } catch {
      /* ignore malformed frames */
    }
  }
  ws.onclose = onClose
  ws.onerror = () => onClose()

  return {
    sendAudio(pcm) {
      if (ws.readyState === WebSocket.OPEN && ready) ws.send(pcm)
      else if (ws.readyState === WebSocket.CONNECTING) pending.push(pcm)
    },
    flush() {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'flush' }))
    },
    close() {
      ws.onclose = null
      ws.onerror = null
      ws.close()
    },
  }
}
