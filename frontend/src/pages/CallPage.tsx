import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { startAudioCapture, type AudioCapture } from '../lib/audio-capture'
import { type CallClient } from '../lib/call-client'
import { callStore } from '../lib/call-store'
import { PcmPlayer } from '../lib/audio-playback'
import { notifyNative } from '../lib/native-bridge'
import { captionHapticEnabled, speechHapticEnabled } from '../lib/haptics-settings'
import { Ringtone } from '../lib/ringtone'
import { authFetch } from '../lib/auth'
import type { LanguageKey } from '../lib/stt-client'
import { fmtNumber, fmtRelative, fmtDuration, fmtTime, resolveDisplay } from '../lib/format'
import Avatar from '../components/Avatar'
import SpeakBoard from '../components/SpeakBoard'
import { PhoneIcon, MicIcon, MicOffIcon, SpeakerIcon, SpeakerOffIcon, XIcon, NewCallIcon } from '../components/icons'

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

// one-tap spoken replies shown above the speak bar
const QUICK_CHIPS = [
  { label: '👍 हाँ', say: 'हाँ।' },
  { label: '👎 ना', say: 'नहीं।' },
  { label: '👌 ठीक है', say: 'ठीक है।' },
  { label: '✋ रुकिए', say: 'कृपया एक क्षण रुकिए।' },
  { label: '🔁 दोबारा', say: 'कृपया अपनी बात दोबारा कहिए।' },
  { label: '📞 बाद में', say: 'मैं आपको बाद में call करती हूँ।' },
]

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
  const [sayText, setSayText] = useState('')
  const [boardOpen, setBoardOpen] = useState(false)
  const typingNoticeSent = useRef(false)
  // whether the caller's voice is audible on this device (a hard-of-hearing
  // user may want sound + captions; a deaf user may keep it off)
  const [speakerOn, setSpeakerOn] = useState(() => localStorage.getItem('speakerOn') !== '0')
  const [recents, setRecents] = useState<RecentCall[]>([])
  const [recentsLoading, setRecentsLoading] = useState(true)
  const [contacts, setContacts] = useState<Contact[]>([])
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
    return resolveDisplay(number, contactsRef.current)
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
    // the version watchdog must never reload the page mid-call
    window.__callActive = state !== 'idle'
    return () => { window.__callActive = false }
  }, [state])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [segments, speaking])

  // living home data
  useEffect(() => {
    if (state !== 'idle') return
    authFetch('/api/calls')
      .then((r) => r.json())
      .then((d) => setRecents((d.calls ?? []).slice(0, 8)))
      .catch(() => {})
      .finally(() => setRecentsLoading(false))
    authFetch('/api/contacts')
      .then((r) => r.json())
      .then((d) => setContacts(d.contacts ?? []))
      .catch(() => {})
  }, [state])

  useEffect(() => {
    const detach = callStore.attach({
      onEvent: (e) => {
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
          typingNoticeSent.current = false
          startTimer()
          setState('active')
        } else if (e.type === 'spoken' && e.text) {
          addSegment('me', `🔊 ${e.text}`)
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
      onAudio: (pcm) => playerRef.current?.play(pcm),
      onStatus: (up) => setConnected(up),
    })
    clientRef.current = callStore.client()
    return () => {
      // detach the UI only — the socket lives app-wide so rings still
      // arrive while the user browses Contacts/Settings
      detach()
      stopTimer()
      stopCallMedia()
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

  async function startMedia(): Promise<boolean> {
    // Caller-audio playback always; the mic is optional — a user who talks
    // by typing (or denied the permission) must still be able to take calls.
    playerRef.current = new PcmPlayer()
    playerRef.current.setSpeaker(speakerOn)
    await playerRef.current.resume()
    try {
      captureRef.current = await startAudioCapture((pcm) => {
        if (!mutedRef.current) clientRef.current?.sendAudio(pcm)
      })
      return true
    } catch {
      return false
    }
  }

  async function startDial(number: string, contactName: string) {
    setError('')
    const mic = await startMedia()
    setCaller(contactName)
    setRingingStatus('Calling…')
    setState('dialing')
    clientRef.current?.dial(number, contactName, language)
    if (!mic) {
      setMuted(true)
      addSegment('sys', '🎤 No mic — reply by typing, the caller will hear your text')
    }
  }

  async function accept() {
    setError('')
    ringtoneRef.current?.stop()
    const mic = await startMedia()
    clientRef.current?.accept(language)
    if (!mic) {
      setMuted(true)
      addSegment('sys', '🎤 No mic — reply by typing, the caller will hear your text')
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

  function toggleSpeaker() {
    setSpeakerOn((on) => {
      const next = !on
      localStorage.setItem('speakerOn', next ? '1' : '0')
      playerRef.current?.setSpeaker(next)
      return next
    })
  }

  function speak(text: string) {
    const t = text.trim()
    if (!t) return
    clientRef.current?.say(t)
    setBoardOpen(false)
  }

  function onSayTyping(value: string) {
    setSayText(value)
    // callers hear silence while the user types and hang up — tell them once
    if (value && !typingNoticeSent.current) {
      typingNoticeSent.current = true
      sendPrompt('wait')
    }
  }

  if (state === 'dialing') {
    const display = resolveName(caller)
    return (
      <main className="call-overlay call-ring">
        <Avatar name={display} />
        <h2>{ringingStatus}</h2>
        <p className="caller-number">{display}</p>
        {error && <p className="status-line error">{error}</p>}
        <div className="ring-actions">
          <span>
            <button className="roundbtn decline" onClick={endCall} aria-label="Cancel"><XIcon size={30} /></button>
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
        <Avatar name={display} />
        <h2>Incoming call</h2>
        <p className="caller-number">{display}</p>
        {error && <p className="status-line error">{error}</p>}
        <div className="ring-actions">
          <span>
            <button className="roundbtn decline" onClick={decline} aria-label="Decline"><XIcon size={30} /></button>
            <span className="roundbtn-label">Decline</span>
          </span>
          <span>
            <button className="roundbtn accept" onClick={() => void accept()} aria-label="Accept"><PhoneIcon size={32} /></button>
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
          <Avatar name={display} variant="small" />
          <div className="call-header-info">
            <b>{display}</b>
            <span className="call-timer">{fmtDuration(callSeconds)}</span>
          </div>
          <button className="iconbtn" onClick={() => changeFont(-2)} aria-label="Smaller text">A−</button>
          <button className="iconbtn" onClick={() => changeFont(2)} aria-label="Larger text">A+</button>
        </div>
        <div className="chips-row">
          <button className="chipbtn board-open" onClick={() => setBoardOpen(true)}>🖼️</button>
          {QUICK_CHIPS.map((c) => (
            <button key={c.label} className="chipbtn" onClick={() => speak(c.say)}>
              {c.label}
            </button>
          ))}
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
        <form
          className="speak-bar"
          onSubmit={(e) => {
            e.preventDefault()
            speak(sayText)
            setSayText('')
          }}
        >
          <input
            className="dialinput speak-input"
            placeholder="Type here, caller hears it… बोलने के लिए टाइप करें"
            value={sayText}
            onChange={(e) => onSayTyping(e.target.value)}
          />
          <button className="bigbtn start speakbtn" type="submit" disabled={!sayText.trim()}>
            🔊
          </button>
        </form>
        <div className="controls">
          <button
            className={`iconbtn framed${muted ? ' active' : ''}`}
            onClick={() => setMuted((m) => !m)}
            aria-label={muted ? 'Unmute' : 'Mute'}
          >
            {muted ? <MicOffIcon size={22} /> : <MicIcon size={22} />}
          </button>
          <button
            className={`iconbtn framed${speakerOn ? '' : ' active'}`}
            onClick={toggleSpeaker}
            aria-label={speakerOn ? 'Speaker off' : 'Speaker on'}
          >
            {speakerOn ? <SpeakerIcon size={22} /> : <SpeakerOffIcon size={22} />}
          </button>
          <button className="bigbtn stop" onClick={endCall}>End call</button>
        </div>
        {boardOpen && <SpeakBoard onSay={speak} onClose={() => setBoardOpen(false)} />}
      </main>
    )
  }

  if (pendingDial) {
    return (
      <main className="call-overlay call-ring">
        <Avatar name={pendingDial.name} />
        <h2>Call</h2>
        <p className="caller-number">{pendingDial.name}</p>
        <p className="idle-hint">{fmtNumber(pendingDial.number)}</p>
        {error && <p className="status-line error">{error}</p>}
        <div className="ring-actions">
          <span>
            <button className="roundbtn decline" onClick={() => navigate('/contacts')} aria-label="Back"><XIcon size={30} /></button>
            <span className="roundbtn-label">Back</span>
          </span>
          <span>
            <button
              className="roundbtn accept"
              onClick={() => {
                navigate('/calls', { replace: true })
                void startDial(pendingDial.number, pendingDial.name)
              }}
              aria-label="Call now"
            ><PhoneIcon size={32} /></button>
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

      {error && <p className="status-line error">{error}</p>}

      <div className="recents-head">
        <h3>Recent</h3>
        <button className="historylink" onClick={() => navigate('/history')}>See all</button>
      </div>
      {recentsLoading && (
        <div className="recents">
          {[0, 1, 2].map((i) => (
            <div className="recent-row" key={i}>
              <div className="avatar tiny skeleton" />
              <div className="recent-main">
                <div className="skeleton skeleton-line w60" />
                <div className="skeleton skeleton-line w40" />
              </div>
            </div>
          ))}
        </div>
      )}
      {!recentsLoading && recents.length === 0 && (
        <p className="idle-hint">
          No calls yet — set up call forwarding from the Home tab, then your
          calls ring right here.
        </p>
      )}
      <div className="recents">
        {recents.map((c) => {
          const display = resolveName(c.from_number)
          const missed = !c.answered
          const out = c.direction === 'out'
          return (
            <div className="recent-row" key={c.id}>
              <Avatar name={display} variant="tiny" />
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
        <NewCallIcon size={26} strokeWidth={2.2} />
      </button>
    </main>
  )
}
