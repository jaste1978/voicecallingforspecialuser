// WebSocket client for the backend call bridge (/ws/call)

import type { LanguageKey } from './stt-client'

export interface CallEvent {
  type:
    | 'ring'
    | 'call_started'
    | 'transcript'
    | 'vad'
    | 'call_ended'
    | 'error'
    | 'language_set'
    | 'dialing'
    | 'outbound_ringing'
  from?: string
  to?: string
  callId?: string
  text?: string
  language_code?: string
  language?: string
  signal?: string
  reason?: string
  message?: string
}

export interface CallClient {
  dial: (number: string, name: string, language: LanguageKey) => void
  accept: (language: LanguageKey) => void
  decline: () => void
  end: () => void
  setLanguage: (language: LanguageKey) => void
  sendPrompt: (name: 'slow_down' | 'repeat' | 'wait') => void
  sendAudio: (pcm: ArrayBuffer) => void
  close: () => void
}

export function connectCall(
  onEvent: (e: CallEvent) => void,
  onAudio: (pcm: ArrayBuffer) => void,
  onClose: () => void,
): CallClient {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  const ws = new WebSocket(`${proto}://${location.host}/ws/call`)
  ws.binaryType = 'arraybuffer'

  ws.onmessage = (e) => {
    if (e.data instanceof ArrayBuffer) {
      onAudio(e.data)
      return
    }
    try {
      onEvent(JSON.parse(e.data as string) as CallEvent)
    } catch {
      /* ignore */
    }
  }
  ws.onclose = onClose
  ws.onerror = () => onClose()

  const sendJson = (obj: unknown) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj))
  }

  return {
    dial: (number, name, language) => sendJson({ type: 'dial', number, name, language }),
    accept: (language) => sendJson({ type: 'accept', language }),
    decline: () => sendJson({ type: 'decline' }),
    end: () => sendJson({ type: 'end' }),
    setLanguage: (language) => sendJson({ type: 'set_language', language }),
    sendPrompt: (name) => sendJson({ type: 'prompt', name }),
    sendAudio: (pcm) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(pcm)
    },
    close: () => {
      ws.onclose = null
      ws.onerror = null
      ws.close()
    },
  }
}
