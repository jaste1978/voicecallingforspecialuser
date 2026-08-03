import { useState } from 'react'
import { authFetch, authName } from '../lib/auth'

const WHATSAPP = 'https://wa.me/919819095969?text=' +
  encodeURIComponent('Namaste! मुझे SunoSathi में मदद चाहिए —')
const EMAIL = 'tnlangalia@gmail.com'

export default function SupportPage() {
  const [message, setMessage] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  async function send() {
    setError('')
    if (!message.trim()) return
    try {
      const resp = await authFetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: authName() || 'App user',
          email: 'support@app.sunosathi.com',
          role: 'support',
          message: message.trim(),
        }),
      })
      if (!resp.ok) throw new Error()
      setSent(true)
    } catch {
      setError('Could not send — try WhatsApp below')
    }
  }

  return (
    <main className="settings-page">
      <section className="setting-block">
        <h3>WhatsApp पर बात कीजिए 💬</h3>
        <p className="idle-hint" style={{ textAlign: 'left' }}>
          सबसे तेज़ तरीका — typing से ही बात होगी, आवाज़ की ज़रूरत नहीं।
        </p>
        <a className="bigbtn start" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 52, textDecoration: 'none', marginTop: 10 }} href={WHATSAPP} target="_blank" rel="noreferrer">
          WhatsApp us
        </a>
      </section>

      <section className="setting-block">
        <h3>Message भेजिए</h3>
        {sent ? (
          <p className="idle-hint" style={{ textAlign: 'left', fontWeight: 600 }}>
            🙏 मिल गया! हम जल्दी जवाब देंगे — usually within a day.
          </p>
        ) : (
          <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>
            <textarea
              className="dialinput"
              rows={4}
              placeholder="अपनी बात लिखिए… what do you need help with?"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={1000}
              style={{ resize: 'vertical', borderRadius: 16 }}
            />
            {error && <p className="status-line error">{error}</p>}
            <button className="bigbtn start" style={{ minHeight: 48 }} disabled={!message.trim()} onClick={() => void send()}>
              Send message
            </button>
          </div>
        )}
      </section>

      <section className="setting-block">
        <h3>Email</h3>
        <p className="idle-hint" style={{ textAlign: 'left' }}>
          <a href={`mailto:${EMAIL}`}>{EMAIL}</a>
        </p>
      </section>
    </main>
  )
}
