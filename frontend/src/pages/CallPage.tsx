import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { startAudioCapture, type AudioCapture } from '../lib/audio-capture'
import { connectCall, type CallClient } from '../lib/call-client'
import { PcmPlayer } from '../lib/audio-playback'
import { notifyNative } from '../lib/native-bridge'
import { captionHapticEnabled, speechHapticEnabled } from '../lib/haptics-settings'
import { Ringtone } from '../lib/ringtone'
import { authFetch } from '../lib/auth'
import type { LanguageKey } from '../lib/stt-client'

interface Segment {
  id: number
  who: 'caller' | 'me' | 'sys'
  text: string
  at: number
}

interface RecentCall {
  id: number
  from_number: string
  direction?: string
  started_at: number
  answered: boolean
  duration_s: number
  reason: string
}

interface Contact {
  id: number
  name: string
  number: string
}

type CallState = 'idle' | 'ringing' | 'dialing' | 'active'

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

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function fmtDuration(s: number): string {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function fmtNumber(num: string): string {
  const d = num.replace(/\D/g, '')
  if (d.length === 12 && d.startsWith('91')) return `+91 ${d.slice(2, 7)} ${d.slice(7)}`
  if (d.length === 10) return `${d.slice(0, 5)} ${d.slice(5)}`
  return num
}

export function fmtRelative(ts: number): string {
  const d = new Date(ts * 1000)
  const now = new Date()
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString()
  if (sameDay(d, now)) return time
  const yest = new Date(now)
  yest.setDate(now.getDate() - 1)
  if (sameDay(d, yest)) return `Yesterday ${time}`
  return `${d.toLocaleDateString([], { day: '2-digit', month: 'short' })}, ${time}`
}

function last10(num: string): string {
  return num.replace(/\D/g, '').slice(-10)
}

function initialOf(name: string): string {
  const ch = (name || '?').trim().charAt(0)
  return /[0-9+]/.test(ch) ? '📞' : ch.toUpperCase()
}

const AVATAR_HUES = [16, 30, 45, 95, 165, 200, 345]
export function avatarColor(name: string): string {
  let h = 0
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 997
  return `hsl(${AVATAR_HUES[h % AVATAR_HUES.length]} 48% 42%)`
}

export default function CallPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const pendingDial = (location.state as { dial?: { number: string; name: string } } | null)?.dial

  const [state, setState] = useState<CallState>('idle')
  const [connected, setConnected] = useState(false)
  const [caller, setCaller] = useState('')
  const [ringingStatus, setRingingStatus] = useState('Connecting…')
  const [segments, setSegments] = useState<Segment[]>([])
  const [speaking, setSpeaking] = useState(false)
  const [muted, setMuted] = useState(false)
  const [error, setError] = useState('')
  const [fontSize, setFontSize] = useState(() => Number(localStorage.getItem('fontSize')) || 22)
  const [callSeconds, setCallSeconds] = useState(0)
  const [ownNumber, setOwnNumber] = useState('')
  const [recents, setRecents] = useState<RecentCall[]>([])
  const [contacts, setContacts] = useState<Contact[]>([])
  const [shared, setShared] = useState(false)
  const language: LanguageKey = 'auto'

  const clientRef = useRef<CallClient | null>(null)
  const captureRef = useRef<AudioCapture | null>(null)
  const playerRef = useRef<PcmPlayer | null>(null)
  const ringtoneRef = useRef<Ringtone | null>(null)
  const mutedRef = useRef(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const nextId = useRef(1)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const contactsRef = useRef<Contact[]>([])
  useEffect(() => {
    contactsRef.current = contacts
  }, [contacts])

  function resolveName(number: string): string {
    const key = last10(number)
    if (!key) return number
    const hit = contactsRef.current.find((c) => last10(c.number) === key)
    return hit ? hit.name : fmtNumber(number)
  }

  function changeFont(delta: number) {
    setFontSize((f) => {
      const next = Math.min(34, Math.max(16, f + delta))
      localStorage.setItem('fontSize', String(next))
      return next
    })
  }

  function addSegment(who: Segment['who'], text: string) {
    setSegments((prev) => [...prev, { id: nextId.current++, who, text, at: Date.now() }])
  }

  function startTimer() {
    stopTimer()
    setCallSeconds(0)
    timerRef.current = setInterval(() => setCallSeconds((s) => s + 1), 1000)
  }

  function stopTimer() {
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = null
  }

  useEffect(() => {
    mutedRef.current = muted
  }, [muted])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [segments, speaking])

  // living home data
  useEffect(() => {
    if (state !== 'idle') return
    authFetch('/api/me')
      .then((r) => r.json())
      .then((d) => setOwnNumber(d.number || ''))
      .catch(() => {})
    authFetch('/api/calls')
      .then((r) => r.json())
      .then((d) => setRecents((d.calls ?? []).slice(0, 8)))
      .catch(() => {})
    authFetch('/api/contacts')
      .then((r) => r.json())
      .then((d) => setContacts(d.contacts ?? []))
      .catch(() => {})
  }, [state])

  useEffect(() => {
    const client = connectCall(
      (e) => {
        if (e.type === 'ring') {
          setCaller(e.from || 'Unknown caller')
          setSegments([])
          setState('ringing')
          navigator.vibrate?.([400, 150, 400, 150, 400])
          notifyNative('ring')
          if (!ringtoneRef.current) ringtoneRef.current = new Ringtone()
          ringtoneRef.current.start()
          clientRef.current?.ackRing()
        } else if (e.type === 'dialing') {
          setCaller(e.to || '')
          setSegments([])
          setRingingStatus('Calling…')
          setState('dialing')
        } else if (e.type === 'outbound_ringing') {
          setRingingStatus('Ringing…')
        } else if (e.type === 'call_started') {
          notifyNative('ring_stop')
          ringtoneRef.current?.stop()
          notifyNative('haptic:connect')
          addSegment('sys', '✓ Call connected')
          startTimer()
          setState('active')
        } else if (e.type === 'transcript' && e.text) {
          setSpeaking(false)
          if (captionHapticEnabled()) notifyNative('haptic:caption')
          setSegments((prev) => {
            const last = prev[prev.length - 1]
            if (last && last.who === 'caller' && e.text!.startsWith(last.text)) {
              return [...prev.slice(0, -1), { ...last, text: e.text!, at: Date.now() }]
            }
            return [...prev, { id: nextId.current++, who: 'caller', text: e.text!, at: Date.now() }]
          })
        } else if (e.type === 'vad') {
          const started = e.signal === 'START_SPEECH'
          if (started && speechHapticEnabled()) notifyNative('haptic:speech')
          setSpeaking(started)
        } else if (e.type === 'language_set') {
          addSegment(
            'sys',
            `Caption language: ${LANG_LABELS[e.language ?? ''] ?? e.language}` +
              (e.provider ? ` · ${e.provider}` : ''),
          )
        } else if (e.type === 'call_ended') {
          notifyNative('ring_stop')
          notifyNative('haptic:end')
          stopTimer()
          stopCallMedia()
          setState('idle')
        } else if (e.type === 'error') {
          setError(e.message || 'Something went wrong')
        }
      },
      (pcm) => playerRef.current?.play(pcm),
      (up) => setConnected(up),
    )
    clientRef.current = client
    return () => {
      stopTimer()
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

  async function startMedia() {
    playerRef.current = new PcmPlayer()
    await playerRef.current.resume()
    captureRef.current = await startAudioCapture((pcm) => {
      if (!mutedRef.current) clientRef.current?.sendAudio(pcm)
    })
  }

  async function startDial(number: string, contactName: string) {
    setError('')
    try {
      await startMedia()
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
      await startMedia()
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
    stopTimer()
    stopCallMedia()
    setState('idle')
  }

  function sendPrompt(name: 'repeat' | 'wait') {
    clientRef.current?.sendPrompt(name)
    addSegment('me', PROMPT_TEXTS[name])
  }

  if (state === 'dialing') {
    const display = resolveName(caller)
    return (
      <main className="call-overlay call-ring">
        <div className="avatar" style={{ background: avatarColor(display) }}>
          {initialOf(display)}
        </div>
        <h2>{ringingStatus}</h2>
        <p className="caller-number">{display}</p>
        {error && <p className="status-line error">{error}</p>}
        <div className="ring-actions">
          <span>
            <button className="roundbtn decline" onClick={endCall} aria-label="Cancel">✕</button>
            <span className="roundbtn-label">Cancel</span>
          </span>
        </div>
      </main>
    )
  }

  if (state === 'ringing') {
    const display = resolveName(caller)
    return (
      <main className="call-overlay call-ring incoming">
        <div className="avatar" style={{ background: avatarColor(display) }}>
          {initialOf(display)}
        </div>
        <h2>Incoming call</h2>
        <p className="caller-number">{display}</p>
        {error && <p className="status-line error">{error}</p>}
        <div className="ring-actions">
          <span>
            <button className="roundbtn decline" onClick={decline} aria-label="Decline">✕</button>
            <span className="roundbtn-label">Decline</span>
          </span>
          <span>
            <button className="roundbtn accept" onClick={() => void accept()} aria-label="Accept">📞</button>
            <span className="roundbtn-label">Accept</span>
          </span>
        </div>
      </main>
    )
  }

  if (state === 'active') {
    const display = resolveName(caller)
    return (
      <main className="call-overlay captions-page">
        <div className="call-header">
          <div className="avatar small" style={{ background: avatarColor(display) }}>
            {initialOf(display)}
          </div>
          <div className="call-header-info">
            <b>{display}</b>
            <span className="call-timer">{fmtDuration(callSeconds)}</span>
          </div>
          <button className="iconbtn" onClick={() => changeFont(-2)} aria-label="Smaller text">A−</button>
          <button className="iconbtn" onClick={() => changeFont(2)} aria-label="Larger text">A+</button>
        </div>
        <div className="prompt-row">
          <button className="promptbtn" onClick={() => sendPrompt('repeat')}>🔁 दोबारा</button>
          <button className="promptbtn" onClick={() => sendPrompt('wait')}>✋ रुकिए</button>
        </div>
        <div ref={scrollRef} className="chat-scroll" style={{ fontSize }}>
          {segments.map((s) =>
            s.who === 'sys' ? (
              <div key={s.id} className="sys-chip">{s.text}</div>
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
          {speaking && (<><span className="dot" /> Caller is speaking…</>)}
        </div>
        <div className="controls">
          <button
            className={`iconbtn framed${muted ? ' active' : ''}`}
            onClick={() => setMuted((m) => !m)}
            aria-label={muted ? 'Unmute' : 'Mute'}
          >
            {muted ? '🔇' : '🎤'}
          </button>
          <button className="bigbtn stop" onClick={endCall}>End call</button>
        </div>
      </main>
    )
  }

  if (pendingDial) {
    return (
      <main className="call-overlay call-ring">
        <div className="avatar" style={{ background: avatarColor(pendingDial.name) }}>
          {initialOf(pendingDial.name)}
        </div>
        <h2>Call</h2>
        <p className="caller-number">{pendingDial.name}</p>
        <p className="idle-hint">{fmtNumber(pendingDial.number)}</p>
        {error && <p className="status-line error">{error}</p>}
        <div className="ring-actions">
          <span>
            <button className="roundbtn decline" onClick={() => navigate('/contacts')} aria-label="Back">✕</button>
            <span className="roundbtn-label">Back</span>
          </span>
          <span>
            <button
              className="roundbtn accept"
              onClick={() => {
                navigate('/', { replace: true })
                void startDial(pendingDial.number, pendingDial.name)
              }}
              aria-label="Call now"
            >📞</button>
            <span className="roundbtn-label">Call now</span>
          </span>
        </div>
      </main>
    )
  }

  // ---- the living home (Calls tab, idle) ----
  return (
    <main className="calls-home">
      <div className={`ready-pill ${connected ? 'ok' : 'bad'}`}>
        {connected ? '🟢 Ready for calls' : '📡 Reconnecting…'}
      </div>

      {ownNumber && (
        <div className="number-card">
          <div>
            <small>Your SunoSathi number</small>
            <b>{ownNumber}</b>
          </div>
          <button
            className="sharebtn"
            onClick={() => {
              const text = `Call me on my SunoSathi number: ${ownNumber}`
              if (navigator.share) void navigator.share({ text })
              else {
                void navigator.clipboard?.writeText(text)
                setShared(true)
                setTimeout(() => setShared(false), 2000)
              }
            }}
          >
            {shared ? '✓ Copied' : 'Share'}
          </button>
        </div>
      )}

      {error && <p className="status-line error">{error}</p>}

      <div className="recents-head">
        <h3>Recent</h3>
        <button className="historylink" onClick={() => navigate('/history')}>See all</button>
      </div>
      {recents.length === 0 && (
        <p className="idle-hint">No calls yet — share your number above to get your first call.</p>
      )}
      <div className="recents">
        {recents.map((c) => {
          const display = resolveName(c.from_number)
          const missed = !c.answered
          const out = c.direction === 'out'
          return (
            <div className="recent-row" key={c.id}>
              <div className="avatar tiny" style={{ background: avatarColor(display) }}>
                {initialOf(display)}
              </div>
              <div className="recent-main">
                <b className={missed ? 'missed-text' : ''}>{display}</b>
                <small>
                  <span className={`dir ${missed ? 'red' : out ? 'orange' : 'green'}`}>
                    {out ? '↗' : missed ? '↓' : '↙'}
                  </span>{' '}
                  {missed ? (c.reason === 'declined' ? 'Declined' : 'Missed') : fmtDuration(c.duration_s)}
                  {' · '}
                  {fmtRelative(c.started_at)}
                </small>
              </div>
            </div>
          )
        })}
      </div>

      <button className="fab" aria-label="New call" onClick={() => navigate('/contacts')}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" width="26" height="26">
          <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" />
          <path d="M15 5h6M18 2v6" />
        </svg>
      </button>
    </main>
  )
}
