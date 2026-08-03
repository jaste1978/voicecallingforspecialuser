import { useState } from 'react'

const FAQS: { q: string; a: string }[] = [
  {
    q: 'मेरा नंबर कैसे जुड़ेगा? · How does my number connect?',
    a: 'अपने फ़ोन से एक बार **21*07971442451# dial कीजिए। बस — आपके नंबर के सारे calls SunoSathi में आने लगेंगे। बंद करने के लिए ##21# dial कीजिए। Your family keeps calling the same number they always did.',
  },
  {
    q: 'Call आए तो क्या करूँ? · What do I do when a call comes?',
    a: 'Phone vibrate होगा और screen पर ring दिखेगी। हरा बटन दबाइए — caller के शब्द आपकी screen पर live आने लगेंगे, chat की तरह।',
  },
  {
    q: 'मैं बोल नहीं सकती/सकता — जवाब कैसे दूँ? · I cannot speak — how do I reply?',
    a: 'तीन तरीके: (1) नीचे type कीजिए — caller आपके शब्द एक natural आवाज़ में सुनेगा। (2) ऊपर के बटन दबाइए — हाँ / ना / ठीक है। (3) 🖼️ picture board खोलिए और तस्वीर दबाइए — पूरा वाक्य बोल दिया जाएगा।',
  },
  {
    q: 'Caller को आवाज़ किसकी सुनाई देती है? · Whose voice does the caller hear?',
    a: 'Settings → My voice में अपनी पसंद की आवाज़ चुनिए (महिला/पुरुष)। हर call में वही आवाज़ रहेगी।',
  },
  {
    q: 'Phone बंद/lock हो तो call आएगी? · Will calls ring when my phone is locked?',
    a: 'हाँ (Android app में)। "SunoSathi is on duty" notification दिखता रहेगा — call आते ही phone लगातार vibrate करेगा और lock screen पर दिखेगा। अगर ring न आए: Settings → Apps → SunoSathi → Battery → Unrestricted कर दीजिए।',
  },
  {
    q: 'Captions किस भाषा में आते हैं? · Which languages are captioned?',
    a: 'हिन्दी, ગુજરાતી, English और Hinglish — अपने आप पहचान होती है, कुछ चुनना नहीं पड़ता। अक्षर बड़े करने हों तो call में A− / A+ दबाइए।',
  },
  {
    q: 'क्या मैं खुद call कर सकती/सकता हूँ? · Can I make outgoing calls?',
    a: 'हाँ। Calls tab में 📞+ बटन दबाइए या Contacts से किसी को चुनिए। Caller को आम call जैसा ही लगेगा — और आपको captions मिलेंगे।',
  },
  {
    q: 'पुरानी calls कहाँ मिलेंगी? · Where are my old calls?',
    a: 'Calls tab में हाल की calls, और "See all" से पूरी history — हर call का पूरा transcript और recording, दोबारा पढ़ने के लिए हमेशा वहाँ।',
  },
  {
    q: 'क्या यह free है? · Is it free?',
    a: 'Pilot के दौरान बिल्कुल free। हमें बस आपका feedback चाहिए।',
  },
]

export default function HelpPage() {
  const [open, setOpen] = useState<number | null>(0)
  return (
    <main className="settings-page">
      {FAQS.map((f, i) => (
        <section className="setting-block faq-item" key={i}>
          <button className="faq-q" onClick={() => setOpen(open === i ? null : i)}>
            <span>{f.q}</span>
            <span className="history-chevron">{open === i ? '▲' : '▼'}</span>
          </button>
          {open === i && <p className="faq-a">{f.a.replace(/\*\*/g, '')}</p>}
        </section>
      ))}
      <p className="idle-hint">और सवाल है? Home → Contact us से पूछिए 🙏</p>
    </main>
  )
}
