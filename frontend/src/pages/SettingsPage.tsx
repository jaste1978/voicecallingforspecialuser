import { useEffect, useState } from 'react'

interface ProviderInfo {
  name: string
  label: string
}

interface Settings {
  stt_provider: string
  tts_provider: string
  available: { stt: ProviderInfo[]; tts: ProviderInfo[] }
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [saved, setSaved] = useState('')

  useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then(setSettings)
      .catch(() => {})
  }, [])

  async function update(kind: 'stt' | 'tts', name: string) {
    const resp = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [`${kind}_provider`]: name }),
    })
    if (resp.ok) {
      setSettings(await resp.json())
      setSaved('Saved — applies from the next call')
      setTimeout(() => setSaved(''), 3000)
    }
  }

  if (!settings) return <main className="stub">Loading…</main>

  return (
    <main className="settings-page">
      <section className="setting-block">
        <h3>Speech to text (captions)</h3>
        <p className="idle-hint">Which AI model converts the caller's voice into captions.</p>
        <select
          className="lang wide"
          value={settings.stt_provider}
          onChange={(e) => void update('stt', e.target.value)}
        >
          {settings.available.stt.map((p) => (
            <option key={p.name} value={p.name}>
              {p.label}
            </option>
          ))}
        </select>
      </section>

      <section className="setting-block">
        <h3>Text to speech (spoken prompts)</h3>
        <p className="idle-hint">Which AI voice speaks your quick phrases into the call.</p>
        <select
          className="lang wide"
          value={settings.tts_provider}
          onChange={(e) => void update('tts', e.target.value)}
        >
          {settings.available.tts.map((p) => (
            <option key={p.name} value={p.name}>
              {p.label}
            </option>
          ))}
        </select>
      </section>

      {saved && <p className="status-line">{saved}</p>}
      <p className="idle-hint">
        More providers can be added over time — each process (captions, voice)
        can use a different model.
      </p>
    </main>
  )
}
