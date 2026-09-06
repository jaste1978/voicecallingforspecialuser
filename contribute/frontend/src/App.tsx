import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import Admin from './components/Admin'
import Auth from './components/Auth'
import Consent from './components/Consent'
import Landing from './components/Landing'
import Pending from './components/Pending'
import type { Take } from './components/Recorder'
import {
  getCurrentConsent, getMe, getPhrases, getProgress, logout, postContribution,
  putVideo, reportVideo,
} from './lib/api'
import type { Auth as AuthResult, Phrase, Progress, User } from './lib/api'
import { loadLang, saveLang } from './lib/device'
import type { Lang } from './lib/device'
import * as turnstile from './lib/turnstile'

// MediaPipe is ~450KB of the bundle and is useless until someone is
// actually in front of the camera. Splitting it out means the pitch and the
// consent screen paint immediately on a phone with one bar of signal, and
// the model code downloads while they are reading.
const Recorder = lazy(() => import('./components/Recorder'))

type Screen = 'landing' | 'auth' | 'pending' | 'consent' | 'record' | 'admin'

/** Refill the queue before it runs dry, so nobody watches a spinner between
 *  two signs. */
const REFILL_AT = 4

const T = {
  hi: {
    thanks: 'धन्यवाद 🙏', signs: (_n: number) => 'साइन दिए', done: 'सब हो गया!',
    doneNote: 'अभी के लिए सारे शब्द रिकॉर्ड हो चुके हैं। बाद में और जुड़ेंगे।',
    loading: 'शब्द लाए जा रहे हैं…', retry: 'दोबारा कोशिश करें',
    videoLost: 'वीडियो नहीं भेजा जा सका, पर साइन का डेटा सुरक्षित है।',
    signOut: 'साइन आउट', admin: 'एडमिन', booting: 'खुल रहा है…',
  },
  en: {
    thanks: 'Thank you 🙏', signs: (n: number) => `sign${n === 1 ? '' : 's'} contributed`,
    done: 'All done!',
    doneNote: 'Every word is recorded for now. More will be added.',
    loading: 'Loading words…', retry: 'Try again',
    videoLost: 'The video did not upload, but your sign data is saved.',
    signOut: 'Sign out', admin: 'Admin', booting: 'Starting…',
  },
} as const

export default function App() {
  const [lang, setLang] = useState<Lang>(loadLang)
  const [screen, setScreen] = useState<Screen>('landing')
  const [user, setUser] = useState<User | null>(null)
  const [consentId, setConsentId] = useState('')
  const [booting, setBooting] = useState(true)
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

  /**
   * Where an account belongs right now. Kept in one place because "signed in
   * but not approved" and "approved but has not consented" are real states a
   * contributor passes through, and scattering that decision across the
   * screens is how someone ends up at a camera without a consent record.
   */
  const routeFor = useCallback(async (u: User | null): Promise<Screen> => {
    if (!u) return 'auth'
    if (u.status !== 'approved') return 'pending'
    if (u.role === 'admin' && window.location.pathname === '/admin') return 'admin'
    const current = await getCurrentConsent().catch(() => ({ consent_id: null }))
    if (!current.consent_id) return 'consent'
    setConsentId(current.consent_id)
    return 'record'
  }, [])

  // Resume wherever this browser left off — a contributor who recorded
  // yesterday should land on a phrase, not on a sign-in form.
  useEffect(() => {
    getMe()
      .then(async ({ user: u }) => {
        setUser(u)
        if (!u) return
        const where = await routeFor(u)
        setScreen(where === 'admin' ? 'admin' : where)
      })
      .catch(() => {})
      .finally(() => setBooting(false))
  }, [routeFor])

  const refill = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setQueue(await getPhrases())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (screen !== 'record') return
    refill()
    getProgress().then(setProgress).catch(() => {})
    if (turnstile.enabled() && turnstileHost.current) {
      turnstile.mount(turnstileHost.current).catch(() => {})
    }
  }, [screen, refill])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(''), 2600)
    return () => clearTimeout(timer)
  }, [toast])

  const goFromLanding = async () => {
    if (!user) return setScreen('auth')
    setScreen(await routeFor(user))
  }

  const onAuthed = async ({ user: u }: AuthResult) => {
    setUser(u)
    setScreen(await routeFor(u))
  }

  const recheck = async () => {
    const { user: u } = await getMe()
    setUser(u)
    setScreen(await routeFor(u))
  }

  const signOut = async () => {
    await logout().catch(() => {})
    setUser(null)
    setConsentId('')
    setQueue([])
    setProgress(null)
    if (window.location.pathname !== '/') window.history.replaceState(null, '', '/')
    setScreen('landing')
  }

  const advance = useCallback(() => {
    setQueue((prev) => {
      const next = prev.slice(1)
      if (next.length <= REFILL_AT) refill()
      return next
    })
  }, [refill])

  const submit = async (take: Take) => {
    const phrase = queue[0]
    if (!phrase || !consentId || busy) return
    setBusy(true)
    setError('')
    try {
      const token = await turnstile.token()
      const result = await postContribution({
        phrase_id: phrase.id,
        consent_id: consentId,
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

      const p = await getProgress().catch(() => null)
      if (p) setProgress(p)
      if (!toast) setToast(`${t.thanks} · ${p?.total ?? 0} ${t.signs(p?.total ?? 0)}`)
      advance()
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      // Access can be withdrawn mid-session — an admin suspends the account,
      // or the consent wording is bumped. Re-route rather than silently
      // dropping every take from here on.
      if (/sign in|not approved|consent/i.test(message)) {
        await recheck()
      }
      setError(message)
    } finally {
      setBusy(false)
    }
  }

  const openAdmin = () => {
    window.history.pushState(null, '', '/admin')
    setScreen('admin')
  }

  const leaveAdmin = async () => {
    window.history.pushState(null, '', '/')
    setScreen(await routeFor(user))
  }

  return (
    <div className="app">
      <header className="bar">
        <span className="brand">सुनोसाथी</span>
        {progress && screen === 'record' && (
          <span className="count">{progress.total} {t.signs(progress.total)}</span>
        )}
        <div className="bar-right">
          {user?.role === 'admin' && screen !== 'admin' && (
            <button className="link" onClick={openAdmin}>{t.admin}</button>
          )}
          {user && screen !== 'pending' && (
            <button className="link" onClick={signOut}>{t.signOut}</button>
          )}
          <div className="langs">
            <button className={lang === 'hi' ? 'on' : ''} onClick={() => setLanguage('hi')}>हिं</button>
            <button className={lang === 'en' ? 'on' : ''} onClick={() => setLanguage('en')}>EN</button>
          </div>
        </div>
      </header>

      <main>
        {booting && <div className="pane"><p className="muted">{t.booting}</p></div>}

        {!booting && screen === 'landing' && <Landing lang={lang} onStart={goFromLanding} />}

        {!booting && screen === 'auth' && (
          <Auth lang={lang} onDone={onAuthed} onBack={() => setScreen('landing')} />
        )}

        {!booting && screen === 'pending' && user && (
          <Pending lang={lang} name={user.name} status={user.status}
                   onRecheck={recheck} onSignOut={signOut} />
        )}

        {!booting && screen === 'consent' && (
          <Consent
            lang={lang}
            onDone={(id) => { setConsentId(id); setScreen('record') }}
            onBack={() => setScreen('landing')}
          />
        )}

        {!booting && screen === 'admin' && user && (
          <Admin selfId={user.id} onLeave={leaveAdmin} />
        )}

        {!booting && screen === 'record' && (
          queue.length > 0 ? (
            <Suspense fallback={<div className="pane"><p className="muted">{t.loading}</p></div>}>
              <Recorder
                key={queue[0].id}
                phrase={queue[0]}
                lang={lang}
                busy={busy}
                onSubmit={submit}
                onSkip={advance}
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
            {screen === 'record' && (
              <button className="btn ghost small" onClick={refill}>{t.retry}</button>
            )}
          </div>
        )}
      </main>

      {toast && <div className="toast">{toast}</div>}
      <div ref={turnstileHost} className="turnstile" />
    </div>
  )
}
