import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import Consent from './components/Consent'
import Landing from './components/Landing'
import type { Take } from './components/Recorder'
import { getPhrases, getProgress, postContribution, putVideo, reportVideo } from './lib/api'
import type { Phrase, Progress } from './lib/api'
import { clearSession, loadLang, loadSession, saveLang, saveSession } from './lib/device'
import type { Lang, Session } from './lib/device'
import * as turnstile from './lib/turnstile'

// MediaPipe is ~450KB of the bundle and is useless until someone is
// actually in front of the camera. Splitting it out means the pitch and the
// consent screen paint immediately on a phone with one bar of signal, and
// the model code downloads while they are reading.
const Recorder = lazy(() => import('./components/Recorder'))

type Screen = 'landing' | 'consent' | 'record'

/** Refill the queue before it runs dry, so nobody watches a spinner between
 *  two signs. */
const REFILL_AT = 4

const T = {
  hi: {
    thanks: 'धन्यवाद 🙏', signs: (_n: number) => 'साइन दिए', done: 'सब हो गया!',
    doneNote: 'अभी के लिए सारे शब्द रिकॉर्ड हो चुके हैं। बाद में और जुड़ेंगे।',
    loading: 'शब्द लाए जा रहे हैं…', retry: 'दोबारा कोशिश करें',
    videoLost: 'वीडियो नहीं भेजा जा सका, पर साइन का डेटा सुरक्षित है।',
  },
  en: {
    thanks: 'Thank you 🙏', signs: (n: number) => `sign${n === 1 ? '' : 's'} contributed`,
    done: 'All done!',
    doneNote: 'Every word is recorded for now. More will be added.',
    loading: 'Loading words…', retry: 'Try again',
    videoLost: 'The video did not upload, but your sign data is saved.',
  },
} as const

export default function App() {
  const [lang, setLang] = useState<Lang>(loadLang)
  const [screen, setScreen] = useState<Screen>('landing')
  const [session, setSession] = useState<Session | null>(loadSession)
  const [queue, setQueue] = useState<Phrase[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [progress, setProgress] = useState<Progress | null>(null)
  const [toast, setToast] = useState('')
  const turnstileHost = useRef<HTMLDivElement>(null)
  const t = T[lang]

  const setLanguage = (l: Lang) => {
    setLang(l)
    saveLang(l)
    document.documentElement.lang = l
  }

  const refill = useCallback(async (contributorId: string) => {
    setLoading(true)
    setError('')
    try {
      const list = await getPhrases(contributorId)
      setQueue(list)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (screen !== 'record' || !session) return
    refill(session.contributorId)
    getProgress(session.contributorId).then(setProgress).catch(() => {})
    if (turnstile.enabled() && turnstileHost.current) {
      turnstile.mount(turnstileHost.current).catch(() => {})
    }
  }, [screen, session, refill])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(''), 2600)
    return () => clearTimeout(timer)
  }, [toast])

  const startFlow = () => setScreen(session ? 'record' : 'consent')

  const onConsented = (s: Session) => {
    saveSession(s)
    setSession(s)
    setScreen('record')
  }

  const advance = useCallback((contributorId: string) => {
    setQueue((prev) => {
      const next = prev.slice(1)
      if (next.length <= REFILL_AT) refill(contributorId)
      return next
    })
  }, [refill])

  const submit = async (take: Take) => {
    const phrase = queue[0]
    if (!session || !phrase || busy) return
    setBusy(true)
    setError('')
    try {
      const token = await turnstile.token()
      const result = await postContribution({
        phrase_id: phrase.id,
        contributor_id: session.contributorId,
        consent_id: session.consentId,
        frames: take.frames,
        duration_ms: take.durationMs,
        fps: take.fps,
        coverage: take.coverage,
        video_mime: take.videoMime,
        ...(token ? { turnstile: token } : {}),
      })

      // Keypoints are already saved at this point. The video is a bonus that
      // is allowed to fail — so its failure is reported, never thrown.
      if (result.upload_url && take.video) {
        const ok = await putVideo(result.upload_url, take.video, take.videoMime)
        reportVideo(result.id, ok).catch(() => {})
        if (!ok) setToast(t.videoLost)
      }

      const p = await getProgress(session.contributorId).catch(() => null)
      if (p) setProgress(p)
      if (!toast) setToast(`${t.thanks} · ${p?.total ?? 0} ${t.signs(p?.total ?? 0)}`)
      advance(session.contributorId)
    } catch (e) {
      // The consent record is gone or was withdrawn — send them back through
      // it rather than silently dropping every subsequent take.
      const message = e instanceof Error ? e.message : String(e)
      if (/consent/i.test(message)) {
        clearSession()
        setSession(null)
        setScreen('consent')
      }
      setError(message)
    } finally {
      setBusy(false)
    }
  }

  const skip = () => {
    if (!session) return
    advance(session.contributorId)
  }

  return (
    <div className="app">
      <header className="bar">
        <span className="brand">सुनोसाथी</span>
        {progress && screen === 'record' && (
          <span className="count">{progress.total} {t.signs(progress.total)}</span>
        )}
        <div className="langs">
          <button className={lang === 'hi' ? 'on' : ''} onClick={() => setLanguage('hi')}>हिं</button>
          <button className={lang === 'en' ? 'on' : ''} onClick={() => setLanguage('en')}>EN</button>
        </div>
      </header>

      <main>
        {screen === 'landing' && <Landing lang={lang} onStart={startFlow} />}

        {screen === 'consent' && (
          <Consent lang={lang} onDone={onConsented} onBack={() => setScreen('landing')} />
        )}

        {screen === 'record' && session && (
          queue.length > 0 ? (
            <Suspense fallback={<div className="pane"><p className="muted">{t.loading}</p></div>}>
              <Recorder
                key={queue[0].id}
                phrase={queue[0]}
                lang={lang}
                busy={busy}
                onSubmit={submit}
                onSkip={skip}
              />
            </Suspense>
          ) : (
            <div className="pane">
              <p className="muted">{loading ? t.loading : t.done}</p>
              {!loading && <p className="muted small">{t.doneNote}</p>}
            </div>
          )
        )}

        {error && (
          <div className="banner err">
            {error}
            {screen === 'record' && session && (
              <button className="btn ghost small" onClick={() => refill(session.contributorId)}>
                {t.retry}
              </button>
            )}
          </div>
        )}
      </main>

      {toast && <div className="toast">{toast}</div>}
      <div ref={turnstileHost} className="turnstile" />
    </div>
  )
}
