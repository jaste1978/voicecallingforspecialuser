import { useEffect, useRef, useState } from 'react'
import { startAudioCapture, type AudioCapture } from '../lib/audio-capture'
import { connectStt, type LanguageKey, type SttClient } from '../lib/stt-client'

interface Segment {
  id: number
  text: string
}

const LANGS: { key: LanguageKey; label: string }[] = [
  { key: 'auto', label: 'Auto 🌐' },
  { key: 'hi', label: 'हिन्दी Hindi' },
  { key: 'gu', label: 'ગુજરાતી Gujarati' },
  { key: 'en', label: 'English' },
  { key: 'hinglish', label: 'हिं+En Hinglish' },
]

export default function CaptionsPage() {
  const [running, setRunning] = useState(false)
  const [language, setLanguage] = useState<LanguageKey>(
    () => (localStorage.getItem('lang') as LanguageKey) || 'auto',
  )
  const [fontSize, setFontSize] = useState(() => Number(localStorage.getItem('fontSize')) || 30)
  const [segments, setSegments] = useState<Segment[]>([])
  const [speaking, setSpeaking] = useState(false)
  const [status, setStatus] = useState('Tap Start and hold the phone near the speaker')
  const [error, setError] = useState('')

  const captureRef = useRef<AudioCapture | null>(null)
  const clientRef = useRef<SttClient | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const nextId = useRef(1)

  useEffect(() => {
    localStorage.setItem('lang', language)
  }, [language])
  useEffect(() => {
    localStorage.setItem('fontSize', String(fontSize))
  }, [fontSize])

  // auto-scroll to newest caption
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [segments, speaking])

  useEffect(() => () => stop(), []) // cleanup on unmount

  async function start() {
    setError('')
    setStatus('Connecting…')
    try {
      const client = connectStt(
        language,
        (e) => {
          if (e.type === 'ready') setStatus('Listening')
          else if (e.type === 'transcript' && e.text) {
            setSpeaking(false)
            setSegments((prev) => {
              const last = prev[prev.length - 1]
              // Sarvam sometimes extends the previous utterance instead of
              // starting a new one — replace rather than duplicate.
              if (last && e.text!.startsWith(last.text)) {
                return [...prev.slice(0, -1), { id: last.id, text: e.text! }]
              }
              return [...prev, { id: nextId.current++, text: e.text! }]
            })
          } else if (e.type === 'vad') {
            setSpeaking(e.signal === 'START_SPEECH')
          } else if (e.type === 'error') {
            setError(e.message || 'Something went wrong')
          }
        },
        () => {
          setStatus('Disconnected')
          setRunning(false)
        },
      )
      clientRef.current = client
      captureRef.current = await startAudioCapture((pcm) => client.sendAudio(pcm))
      setRunning(true)
    } catch (err) {
      setError(err instanceof DOMException ? 'Microphone permission is needed' : String(err))
      setStatus('')
      stop()
    }
  }

  function stop() {
    const wasActive = captureRef.current !== null || clientRef.current !== null
    captureRef.current?.stop()
    captureRef.current = null
    clientRef.current?.close()
    clientRef.current = null
    setRunning(false)
    setSpeaking(false)
    if (wasActive) setStatus('Stopped')
  }

  function changeLanguage(key: LanguageKey) {
    setLanguage(key)
    if (running) {
      // restart the stream in the new language
      stop()
      setTimeout(() => void start(), 150)
    }
  }

  return (
    <main className="captions-page">
      <div className={`status-line${error ? ' error' : ''}`}>{error || status}</div>
      <div ref={scrollRef} className="caption-scroll" style={{ fontSize }}>
        {segments.length === 0 && !speaking && (
          <p className="caption-placeholder">Captions will appear here 👋</p>
        )}
        {segments.map((s, i) => (
          <p
            key={s.id}
            className={`caption-segment${i === segments.length - 1 ? ' latest' : ''}`}
          >
            {s.text}
          </p>
        ))}
      </div>
      <div className="speaking-indicator">
        {speaking && (
          <>
            <span className="dot" /> Someone is speaking…
          </>
        )}
      </div>
      <div className="controls">
        <button
          className="iconbtn"
          aria-label="Smaller text"
          onClick={() => setFontSize((s) => Math.max(20, s - 4))}
        >
          A−
        </button>
        <button
          className="iconbtn"
          aria-label="Bigger text"
          onClick={() => setFontSize((s) => Math.min(56, s + 4))}
        >
          A+
        </button>
        <select
          className="lang"
          value={language}
          onChange={(e) => changeLanguage(e.target.value as LanguageKey)}
          aria-label="Language"
        >
          {LANGS.map((l) => (
            <option key={l.key} value={l.key}>
              {l.label}
            </option>
          ))}
        </select>
        {running ? (
          <button className="bigbtn stop" onClick={stop}>
            ⏹ Stop
          </button>
        ) : (
          <button className="bigbtn start" onClick={() => void start()}>
            🎤 Start
          </button>
        )}
      </div>
    </main>
  )
}
