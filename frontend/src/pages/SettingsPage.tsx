import { useEffect, useState } from 'react'
import { authFetch } from '../lib/auth'

interface ProviderInfo {
  name: string
  label: string
}

interface AddableInfo {
  adapter: string
  label: string
  model_hint: string
}

interface ConfiguredInfo {
  id: number
  name: string
  adapter: string
  label: string
  model: string | null
  api_key_masked: string
}

interface Settings {
  stt_provider: string
  tts_provider: string
  available: { stt: ProviderInfo[]; tts: ProviderInfo[] }
  addable: { stt: AddableInfo[]; tts: AddableInfo[] }
  configured: { stt: ConfiguredInfo[]; tts: ConfiguredInfo[] }
}

const KIND_TITLES: Record<'stt' | 'tts', [string, string]> = {
  stt: ['Speech to text (captions)', "Which AI model converts the caller's voice into captions."],
  tts: ['Text to speech (spoken prompts)', 'Which AI voice speaks your quick phrases into the call.'],
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [saved, setSaved] = useState('')
  const [addingKind, setAddingKind] = useState<'stt' | 'tts' | null>(null)
  const [adapter, setAdapter] = useState('')
  const [label, setLabel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('')

  useEffect(() => {
    authFetch('/api/settings')
      .then((r) => r.json())
      .then(setSettings)
      .catch(() => {})
  }, [])

  function flash(msg: string) {
    setSaved(msg)
    setTimeout(() => setSaved(''), 3000)
  }

  async function setActive(kind: 'stt' | 'tts', name: string) {
    const resp = await authFetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [`${kind}_provider`]: name }),
    })
    if (resp.ok) {
      setSettings(await resp.json())
      flash('Saved — applies from the next call')
    }
  }

  async function addModel() {
    if (!addingKind || !adapter || !label.trim() || !apiKey.trim()) return
    const resp = await authFetch('/api/providers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: addingKind,
        adapter,
        label: label.trim(),
        api_key: apiKey.trim(),
        model: model.trim() || null,
      }),
    })
    if (resp.ok) {
      setSettings(await resp.json())
      setAddingKind(null)
      setAdapter('')
      setLabel('')
      setApiKey('')
      setModel('')
      flash('Model added — select it above to use it')
    } else {
      flash('Could not add model — check the fields')
    }
  }

  async function removeModel(id: number) {
    const resp = await authFetch(`/api/providers/${id}`, { method: 'DELETE' })
    if (resp.ok) {
      setSettings(await resp.json())
      flash('Model removed')
    }
  }

  if (!settings) return <main className="stub">Loading…</main>

  return (
    <main className="settings-page">
      {(['stt', 'tts'] as const).map((kind) => {
        const [title, hint] = KIND_TITLES[kind]
        const addables = settings.addable[kind]
        return (
          <section className="setting-block" key={kind}>
            <h3>{title}</h3>
            <p className="idle-hint">{hint}</p>
            <select
              className="lang wide"
              value={settings[`${kind}_provider`]}
              onChange={(e) => void setActive(kind, e.target.value)}
            >
              {settings.available[kind].map((p) => (
                <option key={p.name} value={p.name}>
                  {p.label}
                </option>
              ))}
            </select>

            {settings.configured[kind].length > 0 && (
              <div className="configured-list">
                {settings.configured[kind].map((c) => (
                  <div className="configured-row" key={c.id}>
                    <span>
                      <strong>{c.label}</strong>{' '}
                      <small>
                        {c.adapter} · key {c.api_key_masked}
                        {c.model ? ` · ${c.model}` : ''}
                      </small>
                    </span>
                    <button className="contact-delete" onClick={() => void removeModel(c.id)}>
                      🗑
                    </button>
                  </div>
                ))}
              </div>
            )}

            {addingKind === kind ? (
              <div className="contact-add-form">
                <select
                  className="lang wide"
                  value={adapter}
                  onChange={(e) => setAdapter(e.target.value)}
                >
                  <option value="">Choose provider…</option>
                  {addables.map((a) => (
                    <option key={a.adapter} value={a.adapter}>
                      {a.label}
                    </option>
                  ))}
                </select>
                <input
                  className="dialinput"
                  placeholder="Display name (e.g. My Deepgram)"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                />
                <input
                  className="dialinput"
                  type="password"
                  placeholder="API key"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                />
                <input
                  className="dialinput"
                  placeholder={
                    addables.find((a) => a.adapter === adapter)?.model_hint ??
                    'model / voice id (optional)'
                  }
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                />
                <div className="contact-add-actions">
                  <button className="iconbtn" onClick={() => setAddingKind(null)}>
                    ✕
                  </button>
                  <button
                    className="bigbtn start"
                    disabled={!adapter || !label.trim() || !apiKey.trim()}
                    onClick={() => void addModel()}
                  >
                    Save model
                  </button>
                </div>
              </div>
            ) : (
              <button className="historylink" onClick={() => setAddingKind(kind)}>
                ＋ Add model
              </button>
            )}
          </section>
        )
      })}

      {saved && <p className="status-line">{saved}</p>}
      <p className="idle-hint">
        Your API keys are stored on your own server and never shown again in full.
      </p>
    </main>
  )
}
