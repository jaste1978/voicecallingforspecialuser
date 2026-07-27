import { useRef, useState } from 'react'
import { Ringtone } from '../lib/ringtone'
import {
  ringtoneEnabled,
  ringtoneVolume,
  setRingtoneEnabled,
  setRingtoneVolume,
} from '../lib/ringtone-settings'

export default function RingtonePage() {
  const [enabled, setEnabled] = useState(ringtoneEnabled())
  const [volume, setVolume] = useState(ringtoneVolume())
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
