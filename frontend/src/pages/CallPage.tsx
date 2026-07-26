import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { startAudioCapture, type AudioCapture } from '../lib/audio-capture'
import { connectCall, type CallClient } from '../lib/call-client'
import { PcmPlayer } from '../lib/audio-playback'
import { notifyNative } from '../lib/native-bridge'
import { Ringtone } from '../lib/ringtone'
import type { LanguageKey } from '../lib/stt-client'

interface Segment {
  id: number
  text: string
}

type CallState = 'idle' | 'ringing' | 'dialing' | 'active' | 'disconnected'

const LANG_LABELS: Record<string, string> = {
  auto: 'Auto 🌐',
  hi: 'हिन्दी',
  gu: 'ગુજરાતી',
  en: 'English',
  hinglish: 'हिं+En',
}

export default function CallPage() {
  const location = useLocation()
  const pendingDial = (location.state as { dial?: { number: string; name: string } } | null)?.dial
  const [state, setState] = useState<CallState>('idle')
  const [caller, setCaller] = useState('')
  const [ringingStatus, setRingingStatus] = useState('Connecting…')
  const [segments, setSegments] = useState<Segment[]>([])
  const [speaking, setSpeaking] = useState(false)
  const [muted, setMuted] = useState(false)
  const [endReason, setEndReason] = useState('')
  const [error, setError] = useState('')
  const [promptNote, setPromptNote] = useState('')
  const promptNoteTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function showPromptNote(note: string) {
    setPromptNote(note)
    if (promptNoteTimer.current) clearTimeout(promptNoteTimer.current)
    promptNoteTimer.current = setTimeout(() => setPromptNote(''), 4000)
  }
  const [fontSize] = useState(() => Number(localStorage.getItem('fontSize')) || 30)
  const navigate = useNavigate()
  // fresh storage key: legacy 'lang' values pre-date auto-detect
  const [language, setLanguage] = useState<LanguageKey>(
    () => (localStorage.getItem('capLang') as LanguageKey) || 'auto',
  )

  function changeLanguage(lang: LanguageKey) {
    setLanguage(lang)
    localStorage.setItem('capLang', lang)
    if (clientRef.current) {
      clientRef.current.setLanguage(lang)
      showPromptNote(`Caption language: ${LANG_LABELS[lang]}`)
    }
  }

  const clientRef = useRef<CallClient | null>(null)
  const captureRef = useRef<AudioCapture | null>(null)
  const playerRef = useRef<PcmPlayer | null>(null)
  const ringtoneRef = useRef<Ringtone | null>(null)
  const mutedRef = useRef(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const nextId = useRef(1)

  useEffect(() => {
    mutedRef.current = muted
  }, [muted])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [segments, speaking])

  useEffect(() => {
    const client = connectCall(
      (e) => {
        if (e.type === 'ring') {
          setCaller(e.from || 'Unknown caller')
          setSegments([])
          setEndReason('')
          setState('ringing')
          navigator.vibrate?.([400, 150, 400, 150, 400])
          notifyNative('ring')
          if (!ringtoneRef.current) ringtoneRef.current = new Ringtone()
          ringtoneRef.current.start()
        } else if (e.type === 'dialing') {
          setCaller(e.to || '')
          setSegments([])
          setEndReason('')
          setRingingStatus('Calling…')
          setState('dialing')
        } else if (e.type === 'outbound_ringing') {
          setRingingStatus('Ringing…')
        } else if (e.type === 'call_started') {
          notifyNative('ring_stop')
          setState('active')
        } else if (e.type === 'transcript' && e.text) {
          setSpeaking(false)
          setSegments((prev) => {
            const last = prev[prev.length - 1]
            if (last && e.text!.startsWith(last.text)) {
              return [...prev.slice(0, -1), { id: last.id, text: e.text! }]
            }
            return [...prev, { id: nextId.current++, text: e.text! }]
          })
        } else if (e.type === 'vad') {
          setSpeaking(e.signal === 'START_SPEECH')
        } else if (e.type === 'call_ended') {
          notifyNative('ring_stop')
          setEndReason(e.reason || 'Call ended')
          stopCallMedia()
          setState('idle')
        } else if (e.type === 'error') {
          setError(e.message || 'Something went wrong')
        }
      },
      (pcm) => playerRef.current?.play(pcm),
      () => setState('disconnected'),
    )
    clientRef.current = client
    return () => {
      stopCallMedia()
      client.close()
    }
  }, [])

  async function startDial(number: string, contactName: string) {
    setError('')
    try {
      playerRef.current = new PcmPlayer()
      await playerRef.current.resume()
      captureRef.current = await startAudioCapture((pcm) => {
        if (!mutedRef.current) clientRef.current?.sendAudio(pcm)
      })
      setCaller(contactName)
      setRingingStatus('Calling…')
      setState('dialing')
      clientRef.current?.dial(number, contactName, language)
    } catch {
      setError('Microphone permission is needed to call')
      stopCallMedia()
    }
  }

  function stopCallMedia() {
    ringtoneRef.current?.stop()
    captureRef.current?.stop()
    captureRef.current = null
    playerRef.current?.close()
    playerRef.current = null
    setSpeaking(false)
    setMuted(false)
  }

  async function accept() {
    setError('')
    ringtoneRef.current?.stop()
    try {
      playerRef.current = new PcmPlayer()
      await playerRef.current.resume()
      captureRef.current = await startAudioCapture((pcm) => {
        if (!mutedRef.current) clientRef.current?.sendAudio(pcm)
      })
      clientRef.current?.accept(language)
    } catch {
      setError('Microphone permission is needed to answer')
      stopCallMedia()
    }
  }

  function decline() {
    notifyNative('ring_stop')
    ringtoneRef.current?.stop()
    clientRef.current?.decline()
    setState('idle')
  }

  function endCall() {
    clientRef.current?.end()
    stopCallMedia()
    setState('idle')
  }

  if (state === 'dialing') {
    return (
      <main className="call-ring dialing">
        <div className="ring-pulse">📞</div>
        <h2>{ringingStatus}</h2>
        <p className="caller-number">{caller}</p>
        {error && <p className="status-line error">{error}</p>}
        <div className="ring-actions">
          <button className="bigbtn stop" onClick={endCall}>
            ✕ Cancel
          </button>
        </div>
      </main>
    )
  }

  if (state === 'ringing') {
    return (
      <main className="call-ring">
        <div className="ring-pulse">📞</div>
        <h2>Incoming call</h2>
        <p className="caller-number">{caller}</p>
        {error && <p className="status-line error">{error}</p>}
        <div className="ring-actions">
          <button className="bigbtn stop" onClick={decline}>
            ✕ Decline
          </button>
          <button className="bigbtn start" onClick={() => void accept()}>
            ✓ Accept
          </button>
        </div>
      </main>
    )
  }

  if (state === 'active') {
    return (
      <main className="captions-page">
        <div className="status-line">
          {promptNote ||
            (
              <>
                On call with <strong>{caller}</strong> — speak normally, they can hear you
              </>
            )}
        </div>
        <div className="prompt-row">
          <select
            className="lang"
            value={language}
            onChange={(e) => changeLanguage(e.target.value as LanguageKey)}
            aria-label="Caption language"
          >
            {Object.entries(LANG_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
          <button
            className="promptbtn"
            onClick={() => {
              clientRef.current?.sendPrompt('repeat')
              showPromptNote('Asked the caller to repeat 🔁')
            }}
          >
            🔁 फिर से कहिए
          </button>
          <button
            className="promptbtn"
            onClick={() => {
              clientRef.current?.sendPrompt('wait')
              showPromptNote('Asked the caller to wait ✋')
            }}
          >
            ✋ एक क्षण रुकिए
          </button>
        </div>
        <div ref={scrollRef} className="caption-scroll" style={{ fontSize }}>
          {segments.length === 0 && (
            <p className="caption-placeholder">
              What the caller says will appear here…
            </p>
          )}
          {segments.length > 0 && (
            <p className="caption-flow">
              {segments.map((s, i) => (
                <span
                  key={s.id}
                  className={i === segments.length - 1 ? 'latest' : ''}
                >
                  {s.text}{' '}
                </span>
              ))}
            </p>
          )}
        </div>
        <div className="speaking-indicator">
          {speaking && (
            <>
              <span className="dot" /> Caller is speaking…
            </>
          )}
        </div>
        <div className="controls">
          <button
            className={`iconbtn${muted ? ' active' : ''}`}
            onClick={() => setMuted((m) => !m)}
            aria-label={muted ? 'Unmute' : 'Mute'}
          >
            {muted ? '🔇' : '🎤'}
          </button>
          <button className="bigbtn stop" onClick={endCall}>
            📵 End call
          </button>
        </div>
      </main>
    )
  }

  if (pendingDial) {
    return (
      <main className="call-ring">
        <div className="ring-pulse">📞</div>
        <h2>Call {pendingDial.name}?</h2>
        <p className="caller-number">{pendingDial.number}</p>
        {error && <p className="status-line error">{error}</p>}
        <div className="ring-actions">
          <button className="bigbtn stop" onClick={() => navigate('/contacts')}>
            ✕ Back
          </button>
          <button
            className="bigbtn start"
            onClick={() => {
              navigate('/call', { replace: true })
              void startDial(pendingDial.number, pendingDial.name)
            }}
          >
            📞 Call now
          </button>
        </div>
      </main>
    )
  }

  return (
    <main className="call-idle">
      <div className="idle-top">
        <p className="idle-icon">☎️</p>
        <h2>{state === 'disconnected' ? 'Connection lost' : 'Waiting for calls'}</h2>
        <p className="idle-hint">
          {state === 'disconnected'
            ? 'Reload the page to reconnect.'
            : 'When someone calls your SunoSathi number, it will ring here. Keep this page open.'}
        </p>
        {endReason && <p className="idle-hint">Last call: {endReason}</p>}
        {error && <p className="status-line error">{error}</p>}
      </div>

      <button className="historylink" onClick={() => navigate('/history')}>
        🕓 View call history
      </button>
    </main>
  )
}
