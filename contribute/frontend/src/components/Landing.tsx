// What this is and who it helps, before anyone is asked for anything.

import { useEffect, useState } from 'react'
import { getStats } from '../lib/api'
import type { Lang } from '../lib/device'

const T = {
  hi: {
    kicker: 'सुनोसाथी · खुला ISL डेटासेट',
    title: 'भारतीय सांकेतिक भाषा, मिलकर सिखाएँ',
    lead: 'AI को साइन लैंग्वेज सिखाने के लिए असली साइन चाहिए — असली लोगों के। '
      + 'आप एक-एक शब्द रिकॉर्ड करके यह डेटासेट बना सकते हैं।',
    how: 'कैसे काम करता है',
    steps: [
      'स्क्रीन पर एक शब्द दिखेगा',
      'उसे साइन में करके 3–5 सेकंड रिकॉर्ड करें',
      'देखकर भेजें, या फिर से करें',
    ],
    why: 'यह डेटा बहरे लोगों के लिए बनी सुनोसाथी ऐप में साइन दिखाने के काम आएगा, '
      + 'और ISL रिसर्च के लिए खुला रहेगा।',
    start: 'शुरू करें',
    clips: 'रिकॉर्डिंग', people: 'योगदान देने वाले', covered: 'शब्द पूरे हुए',
  },
  en: {
    kicker: 'SunoSathi · open ISL dataset',
    title: 'Teach Indian Sign Language, together',
    lead: 'Teaching an AI to sign takes real signing, from real people. '
      + 'You can build that dataset one word at a time.',
    how: 'How it works',
    steps: [
      'A word appears on your screen',
      'Sign it — a 3–5 second recording',
      'Watch it back, then send or redo',
    ],
    why: 'This data will let the SunoSathi app show signs to deaf users, '
      + 'and stays open for ISL research.',
    start: 'Start contributing',
    clips: 'recordings', people: 'contributors', covered: 'words covered',
  },
} as const

interface Props {
  lang: Lang
  onStart: () => void
}

export default function Landing({ lang, onStart }: Props) {
  const t = T[lang]
  const [stats, setStats] = useState<{ clips: number; people: number; phrases_covered: number; phrases_total: number } | null>(null)

  useEffect(() => {
    getStats().then(setStats).catch(() => setStats(null))
  }, [])

  return (
    <div className="pane landing">
      <p className="kicker">{t.kicker}</p>
      <h1>{t.title}</h1>
      <p className="lead">{t.lead}</p>

      <h2>{t.how}</h2>
      <ol className="steps">
        {t.steps.map((s) => <li key={s}>{s}</li>)}
      </ol>

      <p className="why">{t.why}</p>

      {stats && (
        <div className="stats">
          <Stat n={stats.clips} label={t.clips} />
          <Stat n={stats.people} label={t.people} />
          <Stat n={`${stats.phrases_covered}/${stats.phrases_total}`} label={t.covered} />
        </div>
      )}

      <button className="btn primary wide" onClick={onStart}>{t.start}</button>
    </div>
  )
}

function Stat({ n, label }: { n: number | string; label: string }) {
  return (
    <div className="stat">
      <span className="stat-n">{n}</span>
      <span className="stat-label">{label}</span>
    </div>
  )
}
