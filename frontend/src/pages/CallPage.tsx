import { useEffect, useRef, useState } from 'react'
import { startAudioCapture, type AudioCapture } from '../lib/audio-capture'
import { connectCall, type CallClient } from '../lib/call-client'
import { PcmPlayer } from '../lib/audio-playback'
import { notifyNative } from '../lib/native-bridge'
import type { LanguageKey } from '../lib/stt-client'

interface Segment {
  id: number
  text: string
}

interface TimelineEvent {
  t_ms: number
  event: string
  [key: string]: string | number | boolean | undefined
}

interface CallRecord {
  id: number
  from_number: string
  started_at: number
  answered: boolean
  duration_s: number
  reason: string
  transcript: string[]
  timeline: TimelineEvent[]
}

function formatOffset(ms: number): string {
  return `+${(ms / 1000).toFixed(2)}s`
}

function eventDetail(e: TimelineEvent): string {
  return Object.entries(e)
    .filter(([k]) => k !== 't_ms' && k !== 'event')
    .map(([k, v]) => `${k}=${v}`)
    .join('  ')
}

type CallState = 'idle' | 'ringing' | 'active' | 'disconnected'

function formatWhen(ts: number): string {
  return new Date(ts * 1000).toLocaleString([], {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}

function formatDuration(s: number): string {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export default function CallPage() {
  const [state, setState] = useState<CallState>('idle')
  const [caller, setCaller] = useState('')
  const [segments, setSegments] = useState<Segment[]>([])
  const [speaking, setSpeaking] = useState(false)
  const [muted, setMuted] = useState(false)
  const [endReason, setEndReason] = useState('')
  const [error, setError] = useState('')
  const [historyList, setHistoryList] = useState<CallRecord[]>([])
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [fontSize] = useState(() => Number(localStorage.getItem('fontSize')) || 30)
  // Calls are fixed to Hindi for now; language fine-tuning comes later
  const language: LanguageKey = 'hi'

  const clientRef = useRef<CallClient | null>(null)
  const captureRef = useRef<AudioCapture | null>(null)
  const playerRef = useRef<PcmPlayer | null>(null)
  const mutedRef = useRef(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const nextId = useRef(1)

  useEffect(() => {
    mutedRef.current = muted
  }, [muted])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [segments, speaking])

  // load call history whenever we're back on the idle screen
  useEffect(() => {
    if (state !== 'idle') return
    fetch('/api/calls')
      .then((r) => r.json())
      .then((d) => setHistoryList(d.calls ?? []))
      .catch(() => {})
  }, [state])

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

  function stopCallMedia() {
    captureRef.current?.stop()
    captureRef.current = null
    playerRef.current?.close()
    playerRef.current = null
    setSpeaking(false)
    setMuted(false)
  }

  async function accept() {
    setError('')
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
    clientRef.current?.decline()
    setState('idle')
  }

  function endCall() {
    clientRef.current?.end()
    stopCallMedia()
    setState('idle')
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
          On call with <strong>{caller}</strong> — speak normally, they can hear you
        </div>
        <div ref={scrollRef} className="caption-scroll" style={{ fontSize }}>
          {segments.length === 0 && (
            <p className="caption-placeholder">
              What the caller says will appear here…
            </p>
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

      {historyList.length > 0 && (
        <section className="history">
          <h3>Call history</h3>
          {historyList.map((c) => (
            <div key={c.id} className="history-item">
              <button
                className="history-row"
                onClick={() => setExpandedId(expandedId === c.id ? null : c.id)}
              >
                <span className={`history-badge${c.answered ? '' : ' missed'}`}>
                  {c.answered ? '✓' : '✕'}
                </span>
                <span className="history-number">{c.from_number}</span>
                <span className="history-meta">
                  {formatWhen(c.started_at)}
                  {c.answered ? ` · ${formatDuration(c.duration_s)}` : ` · ${c.reason}`}
                </span>
                <span className="history-chevron">
                  {expandedId === c.id ? '▲' : '▼'}
                </span>
              </button>
              {expandedId === c.id && (
                <div className="history-transcript">
                  {c.transcript.length === 0 ? (
                    <p className="idle-hint">No captions for this call.</p>
                  ) : (
                    c.transcript.map((line, i) => <p key={i}>{line}</p>)
                  )}
                  {c.timeline.length > 0 && (
                    <details className="timeline">
                      <summary>Data timeline ({c.timeline.length} events)</summary>
                      <div className="timeline-events">
                        {c.timeline.map((e, i) => (
                          <div
                            key={i}
                            className={`timeline-row${e.event === 'caption' ? ' caption-ev' : ''}`}
                          >
                            <span className="timeline-t">{formatOffset(e.t_ms)}</span>
                            <span className="timeline-name">{e.event}</span>
                            <span className="timeline-detail">{eventDetail(e)}</span>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              )}
            </div>
          ))}
        </section>
      )}
    </main>
  )
}
