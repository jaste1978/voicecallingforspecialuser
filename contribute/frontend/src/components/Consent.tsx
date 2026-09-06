// Consent. Nothing is recorded or uploaded before this screen is passed.
//
// The wording is fetched rather than hardcoded so that the version and the
// hash we store alongside every contribution provably describe the text that
// was actually on this screen.

import { useEffect, useState } from 'react'
import { getConsentDoc, postConsent } from '../lib/api'
import type { ConsentDoc } from '../lib/api'
import { deviceId } from '../lib/device'
import type { Lang } from '../lib/device'

const T = {
  hi: {
    loading: 'लोड हो रहा है…',
    nameLabel: 'नाम (मर्ज़ी से)',
    namePlaceholder: 'जैसे: प्रिया',
    contactLabel: 'फ़ोन या ईमेल (मर्ज़ी से)',
    contactHint: 'सिर्फ़ इसलिए कि आप बाद में अपना डेटा हटवा सकें।',
    agree: 'सहमत हूँ, आगे बढ़ें',
    back: 'वापस',
    needed: 'आगे बढ़ने के लिए ऊपर के दोनों बॉक्स पर टिक करें।',
  },
  en: {
    loading: 'Loading…',
    nameLabel: 'Name (optional)',
    namePlaceholder: 'e.g. Priya',
    contactLabel: 'Phone or email (optional)',
    contactHint: 'Only so you can ask us to delete your data later.',
    agree: 'I agree, continue',
    back: 'Back',
    needed: 'Tick both boxes above to continue.',
  },
} as const

interface Props {
  lang: Lang
  onDone: (s: { contributorId: string; consentId: string; consentVersion: string }) => void
  onBack: () => void
}

export default function Consent({ lang, onDone, onBack }: Props) {
  const t = T[lang]
  const [doc, setDoc] = useState<ConsentDoc | null>(null)
  const [checks, setChecks] = useState<Record<string, boolean>>({})
  const [name, setName] = useState('')
  const [contact, setContact] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    getConsentDoc().then(setDoc).catch((e: Error) => setError(e.message))
  }, [])

  if (error) return <div className="pane"><p className="err">{error}</p></div>
  if (!doc) return <div className="pane"><p className="muted">{t.loading}</p></div>

  const required = doc.checks.filter((c) => c.required)
  const ready = required.every((c) => checks[c.id])

  const submit = async () => {
    if (!ready || busy) return
    setBusy(true)
    setError('')
    try {
      const r = await postConsent({
        device_id: deviceId(),
        display_name: name.trim(),
        contact: contact.trim(),
        lang,
        checks,
      })
      onDone({
        contributorId: r.contributor_id,
        consentId: r.consent_id,
        consentVersion: r.version,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  return (
    <div className="pane consent">
      <h1>{doc.title[lang]}</h1>

      <ul className="points">
        {doc.points.map((p, i) => (
          <li key={i}>
            <span className="p-main" lang={lang}>{p[lang]}</span>
            {/* Both languages, always. Someone reading past the language they
                chose is exactly the person this screen must not fail. */}
            <span className="p-alt" lang={lang === 'hi' ? 'en' : 'hi'}>
              {lang === 'hi' ? p.en : p.hi}
            </span>
          </li>
        ))}
      </ul>

      <div className="checks">
        {doc.checks.map((c) => (
          <label key={c.id} className={`check ${c.required ? 'required' : ''}`}>
            <input
              type="checkbox"
              checked={!!checks[c.id]}
              onChange={(e) => setChecks((prev) => ({ ...prev, [c.id]: e.target.checked }))}
            />
            <span>
              <span className="c-main">{c[lang]}</span>
              <span className="c-alt">{lang === 'hi' ? c.en : c.hi}</span>
            </span>
          </label>
        ))}
      </div>

      <div className="fields">
        <label>
          <span>{t.nameLabel}</span>
          <input value={name} onChange={(e) => setName(e.target.value)}
                 placeholder={t.namePlaceholder} maxLength={80} />
        </label>
        <label>
          <span>{t.contactLabel}</span>
          <input value={contact} onChange={(e) => setContact(e.target.value)}
                 inputMode="email" maxLength={120} />
          <small>{t.contactHint}</small>
        </label>
      </div>

      {!ready && <p className="muted small">{t.needed}</p>}

      <div className="controls">
        <button className="btn ghost" onClick={onBack} disabled={busy}>{t.back}</button>
        <button className="btn primary" onClick={submit} disabled={!ready || busy}>
          {t.agree}
        </button>
      </div>
      <p className="version">v{doc.version}</p>
    </div>
  )
}
