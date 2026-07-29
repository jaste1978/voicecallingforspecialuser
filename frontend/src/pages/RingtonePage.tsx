import { useRef, useState } from 'react'
import { Ringtone } from '../lib/ringtone'
import {
  ringtoneEnabled,
  ringtoneVolume,
  setRingtoneEnabled,
  setRingtoneVolume,
} from '../lib/ringtone-settings'
import {
  captionHapticEnabled,
  setCaptionHaptic,
  setSpeechHaptic,
  speechHapticEnabled,
} from '../lib/haptics-settings'
import { notifyNative } from '../lib/native-bridge'

export default function RingtonePage() {
  const [enabled, setEnabled] = useState(ringtoneEnabled())
  const [volume, setVolume] = useState(ringtoneVolume())
  const [speechHaptic, setSpeechHapticState] = useState(speechHapticEnabled())
  const [captionHaptic, setCaptionHapticState] = useState(captionHapticEnabled())
  const [testing, setTesting] = useState(false)
  const testRef = useRef<Ringtone | null>(null)

  function toggle() {
    const next = !enabled
    setEnabled(next)
    setRingtoneEnabled(next)
    if (!next) stopTest()
  }

  function changeVolume(v: number) {
    setVolume(v)
    setRingtoneVolume(v)
  }

  function startTest() {
    stopTest()
    testRef.current = new Ringtone()
    testRef.current.start()
    setTesting(true)
  }

  function stopTest() {
    testRef.current?.stop()
    testRef.current = null
    setTesting(false)
  }

  return (
    <main className="settings-page">
      <section className="setting-block">
        <h3>Ringtone on incoming calls</h3>
        <p className="idle-hint">
          Plays an audible ring along with vibration and the flashing screen —
          useful for family nearby or residual hearing.
        </p>
        <button className={`bigbtn ${enabled ? 'stop' : 'start'}`} onClick={toggle}>
          {enabled ? '🔕 Turn ringtone off' : '🔔 Turn ringtone on'}
        </button>
      </section>

      {enabled && (
        <>
          <section className="setting-block">
            <h3>Volume</h3>
            <input
              className="volume-slider"
              type="range"
              min="0.1"
              max="1"
              step="0.1"
              value={volume}
              onChange={(e) => changeVolume(Number(e.target.value))}
            />
            <p className="idle-hint">{Math.round(volume * 100)}%</p>
          </section>

          <section className="setting-block">
            <h3>Vibration during calls</h3>
            <p className="idle-hint">
              Your phone taps you so you never have to stare at the screen.
            </p>
            <button
              className={`bigbtn ${speechHaptic ? 'stop' : 'start'}`}
              onClick={() => {
                const next = !speechHaptic
                setSpeechHapticState(next)
                setSpeechHaptic(next)
                if (next) notifyNative('haptic:speech')
              }}
            >
              {speechHaptic
                ? '📳 Caller-speaking tap: ON'
                : '📴 Caller-speaking tap: OFF'}
            </button>
            <div style={{ height: 10 }} />
            <button
              className={`bigbtn ${captionHaptic ? 'stop' : 'start'}`}
              onClick={() => {
                const next = !captionHaptic
                setCaptionHapticState(next)
                setCaptionHaptic(next)
                if (next) notifyNative('haptic:caption')
              }}
            >
              {captionHaptic
                ? '📳 Tick on every caption: ON'
                : '📴 Tick on every caption: OFF'}
            </button>
          </section>

          <section className="setting-block">
            <h3>Test</h3>
            {testing ? (
              <button className="bigbtn stop" onClick={stopTest}>
                ⏹ Stop test ring
              </button>
            ) : (
              <button className="bigbtn start" onClick={startTest}>
                ▶️ Play test ring
              </button>
            )}
          </section>
        </>
      )}
    </main>
  )
}
