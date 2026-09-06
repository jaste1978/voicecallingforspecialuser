// The waiting room. Shown to an account an admin has not let in yet.

import type { Status } from '../lib/api'
import type { Lang } from '../lib/device'

const T = {
  hi: {
    pending: 'मंज़ूरी का इंतज़ार',
    pendingLead: 'आपका खाता बन गया है। हम इसे देखकर जल्दी मंज़ूरी देंगे — आमतौर पर एक दिन में।',
    pendingNote: 'मंज़ूरी मिलने के बाद इसी नंबर/ईमेल से साइन इन करके रिकॉर्डिंग शुरू करें।',
    rejected: 'यह खाता मंज़ूर नहीं हुआ',
    rejectedLead: 'अगर आपको लगता है कि यह गलती है, तो namaste@sunosathi.com पर लिखें।',
    check: 'फिर से देखें',
    signOut: 'साइन आउट',
  },
  en: {
    pending: 'Waiting for approval',
    pendingLead: 'Your account is created. We will review it shortly — usually within a day.',
    pendingNote: 'Once approved, sign in with the same number or email and start recording.',
    rejected: 'This account was not approved',
    rejectedLead: 'If you think this is a mistake, write to namaste@sunosathi.com.',
    check: 'Check again',
    signOut: 'Sign out',
  },
} as const

interface Props {
  lang: Lang
  name: string
  status: Status
  onRecheck: () => void
  onSignOut: () => void
}

export default function Pending({ lang, name, status, onRecheck, onSignOut }: Props) {
  const t = T[lang]
  const blocked = status === 'rejected' || status === 'suspended'

  return (
    <div className="pane waiting">
      <div className="waiting-mark">{blocked ? '·' : '🙏'}</div>
      <h1>{blocked ? t.rejected : t.pending}</h1>
      <p className="lead">{blocked ? t.rejectedLead : t.pendingLead}</p>
      {!blocked && <p className="muted">{t.pendingNote}</p>}
      <p className="muted small">{name}</p>

      <div className="controls">
        <button className="btn ghost" onClick={onSignOut}>{t.signOut}</button>
        {!blocked && <button className="btn primary" onClick={onRecheck}>{t.check}</button>}
      </div>
    </div>
  )
}
