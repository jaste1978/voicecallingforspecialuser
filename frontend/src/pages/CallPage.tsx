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
  who: 'caller' | 'me' | 'sys'
  text: string
  at: number
}

type CallState = 'idle' | 'ringing' | 'dialing' | 'active' | 'disconnected'

const LANG_LABELS: Record<string, string> = {
  auto: 'Auto 🌐',
  hi: 'हिन्दी',
  gu: 'ગુજરાતી',
  en: 'English',
  hinglish: 'हिं+En',
  romanized: 'Writing as it sounds (ABC)',
}

const PROMPT_TEXTS: Record<string, string> = {
  repeat: '🔁 कृपया अपनी बात दोबारा कहिए।',
  wait: '✋ कृपया एक क्षण रुकिए।',
}

function timeNow(): number {
  return Date.now()
}

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function initialOf(name: string): string {
  const ch = (name || '?').trim().charAt(0)
  return /[0-9+]/.test(ch) ? '📞' : ch.toUpperCase()
}

export default function CallPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const pendingDial = (location.state as { dial?: { number: string; name: string } } | null)?.dial

  const [state, setState] = useState<CallState>('idle')
  const [caller, setCaller] = useState('')
  const [ringingStatus, setRingingStatus] = useState('Connecting…')
  const [segments, setSegments] = useState<Segment[]>([])
  const [speaking, setSpeaking] = useState(false)
  const [muted, setMuted] = useState(false)
  const [endReason, setEndReason] = useState('')
  const [error, setError] = useState('')
  const [fontSize] = useState(() => Number(localStorage.getItem('fontSize')) || 22)
  // language is always auto-detected; the backend switches to romanized
  // output by itself when it can't identify the language
  const language: LanguageKey = 'auto'

  const clientRef = useRef<CallClient | null>(null)
  const captureRef = useRef<AudioCapture | null>(null)
  const playerRef = useRef<PcmPlayer | null>(null)
  const ringtoneRef = useRef<Ringtone | null>(null)
  const mutedRef = useRef(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const nextId = useRef(1)

  function addSegment(who: Segment['who'], text: string) {
    setSegments((prev) => [...prev, { id: nextId.current++, who, text, at: timeNow() }])
  }

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
          ringtoneRef.current?.stop()
          addSegment('sys', '✓ Call connected')
          setState('active')
        } else if (e.type === 'transcript' && e.text) {
          setSpeaking(false)
          setSegments((prev) => {
            const last = prev[prev.length - 1]
            if (last && last.who === 'caller' && e.text!.startsWith(last.text)) {
              return [
                ...prev.slice(0, -1),
                { ...last, text: e.text!, at: timeNow() },
              ]
            }
            return [
              ...prev,
              { id: nextId.current++, who: 'caller', text: e.text!, at: timeNow() },
            ]
          })
        } else if (e.type === 'vad') {
          setSpeaking(e.signal === 'START_SPEECH')
        } else if (e.type === 'call_ended') {
          notifyNative('ring_stop')
          setEndReason(e.reason || 'Call ended')
          stopCallMedia()
          setState('idle')
        } else if (e.type === 'language_set') {
          addSegment(
            'sys',
            `Caption language: ${LANG_LABELS[e.language ?? ''] ?? e.language}` +
              (e.provider ? ` · ${e.provider}` : ''),
          )
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

  function stopCallMedia() {
    ringtoneRef.current?.stop()
    captureRef.current?.stop()
    captureRef.current = null
    playerRef.current?.close()
    playerRef.current = null
    setSpeaking(false)
    setMuted(false)
  }

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

  function sendPrompt(name: 'repeat' | 'wait') {
    clientRef.current?.sendPrompt(name)
    addSegment('me', PROMPT_TEXTS[name])
  }

  if (state === 'dialing') {
    return (
      <main className="call-ring">
        <div className="avatar">{initialOf(caller)}</div>
        <h2>{ringingStatus}</h2>
        <p className="caller-number">{caller}</p>
        {error && <p className="status-line error">{error}</p>}
        <div className="ring-actions">
          <span>
            <button className="roundbtn decline" onClick={endCall} aria-label="Cancel">
              ✕
            </button>
            <span className="roundbtn-label">Cancel</span>
          </span>
        </div>
      </main>
    )
  }

  if (state === 'ringing') {
    return (
      <main className="call-ring incoming">
        <div className="avatar">{initialOf(caller)}</div>
        <h2>Incoming call</h2>
        <p className="caller-number">{caller}</p>
        {error && <p className="status-line error">{error}</p>}
        <div className="ring-actions">
          <span>
            <button className="roundbtn decline" onClick={decline} aria-label="Decline">
              ✕
            </button>
            <span className="roundbtn-label">Decline</span>
          </span>
          <span>
            <button className="roundbtn accept" onClick={() => void accept()} aria-label="Accept">
              📞
            </button>
            <span className="roundbtn-label">Accept</span>
          </span>
        </div>
      </main>
    )
  }

  if (state === 'active') {
    return (
      <main className="captions-page">
        <div className="prompt-row">
          <button className="promptbtn" onClick={() => sendPrompt('repeat')}>
            🔁 दोबारा
          </button>
          <button className="promptbtn" onClick={() => sendPrompt('wait')}>
            ✋ रुकिए
          </button>
        </div>
        <div ref={scrollRef} className="chat-scroll" style={{ fontSize }}>
          <div className="sys-chip">📞 On call with {caller} — speak normally</div>
          {segments.map((s) =>
            s.who === 'sys' ? (
              <div key={s.id} className="sys-chip">
                {s.text}
              </div>
            ) : (
              <div key={s.id} className={`bubble ${s.who === 'me' ? 'out' : 'in'}`}>
                {s.text}
                <span className="bubble-time">{fmtTime(s.at)}</span>
              </div>
            ),
          )}
          {segments.filter((s) => s.who !== 'sys').length === 0 && (
            <p className="caption-placeholder">The caller's words will appear here…</p>
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
        <div className="avatar">{initialOf(pendingDial.name)}</div>
        <h2>Call</h2>
        <p className="caller-number">{pendingDial.name}</p>
        <p className="idle-hint">{pendingDial.number}</p>
        {error && <p className="status-line error">{error}</p>}
        <div className="ring-actions">
          <span>
            <button
              className="roundbtn decline"
              onClick={() => navigate('/contacts')}
              aria-label="Back"
            >
              ✕
            </button>
            <span className="roundbtn-label">Back</span>
          </span>
          <span>
            <button
              className="roundbtn accept"
              onClick={() => {
                navigate('/call', { replace: true })
                void startDial(pendingDial.number, pendingDial.name)
              }}
              aria-label="Call now"
            >
              📞
            </button>
            <span className="roundbtn-label">Call now</span>
          </span>
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
