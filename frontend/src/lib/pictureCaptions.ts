// Picture Captions (चित्र मोड) — Phase 3 Track A.
// Turns caption text into a strip of 2D concept cards so sign-first and
// low-literacy users understand faster. The renderer is deliberately
// swappable: anything that maps text → visual cards can replace the
// emoji artwork later (custom SVG, ISL sign drawings, generated signing).
//
// Dictionary seeded from word-frequency analysis of 246 real pilot calls
// (Gujarati-first, then Hindi, then English) plus core call-domain
// concepts. Function words get no card on purpose — meaning only.

export interface PictureCard {
  emoji: string
  word: string // Hindi display word under the artwork
}

interface Concept extends PictureCard {
  match: string[] // lowercase word forms in hi / gu / en that map here
}

const CONCEPTS: Concept[] = [
  // greetings & social
  { emoji: '🙏', word: 'नमस्ते', match: ['नमस्ते', 'नमस्कार', 'namaste', 'hello', 'हेलो', 'હેલો', 'जय', 'જય'] },
  { emoji: '👍', word: 'हाँ', match: ['हाँ', 'हां', 'हा', 'હા', 'yes', 'yeah', 'હોવે'] },
  { emoji: '👎', word: 'नहीं', match: ['नहीं', 'नही', 'ना', 'નથી', 'નહીં', 'ના', 'no', 'nahi'] },
  { emoji: '👌', word: 'ठीक', match: ['ठीक', 'બરાબર', 'okay', 'ok', 'ओके', 'ઓકે', 'theek', 'सही', 'accha', 'अच्छा', 'સારું'] },
  { emoji: '🙏🏻', word: 'धन्यवाद', match: ['धन्यवाद', 'शुक्रिया', 'thanks', 'thank', 'આભાર'] },
  { emoji: '❤️', word: 'प्यार', match: ['प्यार', 'પ્રેમ', 'love'] },
  { emoji: '😊', word: 'खुश', match: ['खुश', 'ખુશ', 'happy', 'મજા', 'मज़ा'] },
  { emoji: '😢', word: 'दुख', match: ['दुख', 'दुखी', 'sad', 'રડવું', 'उदास'] },
  // people & family
  { emoji: '👩', word: 'माँ', match: ['माँ', 'मम्मी', 'મમ્મી', 'મા', 'mummy', 'mother', 'अम्मा', 'બા'] },
  { emoji: '👨', word: 'पिता', match: ['पिता', 'पापा', 'પપ્પા', 'papa', 'father', 'बाप'] },
  { emoji: '👦', word: 'बेटा', match: ['बेटा', 'દીકરો', 'son', 'लड़का', 'છોકરો'] },
  { emoji: '👧', word: 'बेटी', match: ['बेटी', 'દીકરી', 'daughter', 'लड़की', 'છોકરી'] },
  { emoji: '👫', word: 'भाई-बहन', match: ['भाई', 'ભાઈ', 'brother', 'बहन', 'બહેન', 'sister', 'दीदी'] },
  { emoji: '🧑‍🤝‍🧑', word: 'दोस्त', match: ['दोस्त', 'મિત્ર', 'friend', 'यार', 'साथी', 'સાથી'] },
  { emoji: '👪', word: 'परिवार', match: ['परिवार', 'પરિવાર', 'family', 'घरवाले'] },
  // communication (our core domain, heavy in real transcripts)
  { emoji: '📞', word: 'कॉल', match: ['कॉल', 'કૉલ', 'કોલ', 'call', 'फोन', 'ફોન', 'phone'] },
  { emoji: '🗣️', word: 'बोलना', match: ['बोल', 'बोलो', 'बोलना', 'बोलूं', 'બોલ', 'બોલો', 'બોલું', 'speak', 'बोलिए', 'कहना', 'कहो'] },
  { emoji: '👂', word: 'सुनना', match: ['सुन', 'सुनो', 'सुना', 'सुनाई', 'સાંભળ', 'સંભળાય', 'listen', 'hear', 'सुनिए'] },
  { emoji: '💬', word: 'बात', match: ['बात', 'વાત', 'talk', 'बातें', 'message', 'मैसेज', 'મેસેજ'] },
  { emoji: '⌨️', word: 'टाइप', match: ['टाइप', 'ટાઈપ', 'type', 'लिखो', 'लिखा', 'લખ', 'લખો', 'write'] },
  { emoji: '📖', word: 'पढ़ना', match: ['पढ़', 'पढ़ो', 'पढ़ना', 'વાંચ', 'વાંચો', 'read'] },
  { emoji: '👀', word: 'देखना', match: ['देख', 'देखो', 'दिख', 'दिखा', 'જુઓ', 'દેખાય', 'જોવું', 'see', 'look', 'दिखाई'] },
  { emoji: '🔢', word: 'नंबर', match: ['नंबर', 'નંબર', 'number', 'नम्बर'] },
  { emoji: '❓', word: 'सवाल', match: ['क्या', 'શું', 'what', 'कैसे', 'કેમ', 'કેવી', 'how', 'क्यों', 'why', 'कौन', 'કોણ', 'who', 'कहाँ', 'ક્યાં', 'where', 'कब', 'ક્યારે', 'when'] },
  { emoji: '🆘', word: 'मदद', match: ['मदद', 'મદદ', 'help', 'सहायता'] },
  { emoji: '✋', word: 'रुको', match: ['रुको', 'रुकिए', 'ઊભા', 'રોકો', 'wait', 'ठहरो', 'stop'] },
  { emoji: '🔁', word: 'फिर से', match: ['फिर', 'दोबारा', 'ફરી', 'repeat', 'again', 'वापस', 'પાછું'] },
  // time
  { emoji: '📅', word: 'कल', match: ['कल', 'કાલે', 'tomorrow', 'yesterday'] },
  { emoji: '☀️', word: 'आज', match: ['आज', 'આજે', 'today'] },
  { emoji: '⏰', word: 'समय', match: ['समय', 'टाइम', 'સમય', 'ટાઈમ', 'time', 'बजे', 'વાગ્યે', 'घंटा'] },
  { emoji: '🌅', word: 'सुबह', match: ['सुबह', 'સવારે', 'morning'] },
  { emoji: '🌙', word: 'रात', match: ['रात', 'રાત', 'night', 'शाम', 'સાંજ', 'evening'] },
  { emoji: '⏳', word: 'अभी', match: ['अभी', 'હમણાં', 'now', 'હવે', 'तुरंत'] },
  { emoji: '🐢', word: 'बाद में', match: ['बाद', 'પછી', 'later', 'फिर कभी'] },
  // actions & movement
  { emoji: '🏃', word: 'आना', match: ['आओ', 'आना', 'आ', 'आइए', 'આવ', 'આવે', 'આવો', 'come', 'आये', 'आएगा', 'आऊं'] },
  { emoji: '🚶', word: 'जाना', match: ['जाओ', 'जाना', 'जा', 'જા', 'જવું', 'જાઓ', 'go', 'गया', 'ગયો', 'निकल'] },
  { emoji: '🤝', word: 'मिलना', match: ['मिलो', 'मिलना', 'मिलते', 'મળ', 'મળીએ', 'meet', 'मुलाकात'] },
  { emoji: '💼', word: 'काम', match: ['काम', 'કામ', 'work', 'job', 'नौकरी', 'ऑफिस', 'ઓફિસ', 'office'] },
  { emoji: '🛠️', word: 'करना', match: ['करो', 'करना', 'કરો', 'કરી', 'કરવું', 'do', 'किया', 'કર્યું'] },
  { emoji: '🎁', word: 'देना', match: ['दो', 'देना', 'दे', 'આપ', 'આપો', 'give', 'दिया', 'આપ્યું'] },
  { emoji: '🤲', word: 'लेना', match: ['लो', 'लेना', 'ले', 'લે', 'લો', 'take', 'लिया', 'લીધું'] },
  { emoji: '😴', word: 'सोना', match: ['सो', 'सोना', 'नींद', 'ઊંઘ', 'સૂવું', 'sleep'] },
  // places
  { emoji: '🏠', word: 'घर', match: ['घर', 'ઘર', 'home', 'house', 'ઘરે'] },
  { emoji: '🏥', word: 'अस्पताल', match: ['अस्पताल', 'હોસ્પિટલ', 'hospital', 'दवाखाना'] },
  { emoji: '🩺', word: 'डॉक्टर', match: ['डॉक्टर', 'ડૉક્ટર', 'ડોક્ટર', 'doctor', 'वैद्य'] },
  { emoji: '🏫', word: 'स्कूल', match: ['स्कूल', 'સ્કૂલ', 'school', 'कॉलेज', 'કૉલેજ', 'college'] },
  { emoji: '🏪', word: 'दुकान', match: ['दुकान', 'દુકાન', 'shop', 'बाज़ार', 'બજાર', 'market', 'मार्केट'] },
  { emoji: '🛕', word: 'मंदिर', match: ['मंदिर', 'મંદિર', 'temple', 'पूजा', 'પૂજા', 'दर्शन', 'દર્શન'] },
  { emoji: '🏦', word: 'बैंक', match: ['बैंक', 'બેંક', 'bank'] },
  // things & needs
  { emoji: '💰', word: 'पैसा', match: ['पैसा', 'पैसे', 'પૈસા', 'money', 'रुपये', 'રૂપિયા', 'rupees', 'रकम'] },
  { emoji: '🍽️', word: 'खाना', match: ['खाना', 'खा', 'જમ', 'જમવાનું', 'ખાવાનું', 'eat', 'food', 'भोजन', 'खाया', 'જમ્યા'] },
  { emoji: '💧', word: 'पानी', match: ['पानी', 'પાણી', 'water'] },
  { emoji: '☕', word: 'चाय', match: ['चाय', 'ચા', 'tea', 'कॉफी', 'coffee'] },
  { emoji: '🥛', word: 'दूध', match: ['दूध', 'દૂધ', 'milk'] },
  { emoji: '💊', word: 'दवाई', match: ['दवाई', 'दवा', 'દવા', 'medicine', 'गोली'] },
  { emoji: '📱', word: 'मोबाइल', match: ['मोबाइल', 'મોબાઈલ', 'mobile', 'app', 'एप', 'ऐप', 'એપ'] },
  { emoji: '🚗', word: 'गाड़ी', match: ['गाड़ी', 'ગાડી', 'car', 'कार'] },
  { emoji: '🚌', word: 'बस', match: ['बस', 'બસ', 'bus', 'ट्रेन', 'ટ્રેન', 'train', 'रिक्शा', 'રિક્ષા'] },
  { emoji: '🎂', word: 'जन्मदिन', match: ['जन्मदिन', 'birthday', 'જન્મદિવસ'] },
  { emoji: '💍', word: 'शादी', match: ['शादी', 'લગ્ન', 'wedding', 'marriage', 'विवाह', 'सगाई'] },
  { emoji: '🎉', word: 'त्योहार', match: ['त्योहार', 'તહેવાર', 'festival', 'दिवाली', 'દિવાળી', 'होली', 'नवरात्रि', 'નવરાત્રી', 'ईद', 'रक्षाबंधन'] },
  // states & qualities
  { emoji: '🤒', word: 'बीमार', match: ['बीमार', 'બીમાર', 'sick', 'तबीयत', 'તબિયત', 'बुखार', 'તાવ', 'दर्द', 'દુખાવો'] },
  { emoji: '💪', word: 'अच्छा है', match: ['बढ़िया', 'સરસ', 'good', 'fine', 'મસ્ત', 'बेहतर'] },
  { emoji: '⚠️', word: 'समस्या', match: ['समस्या', 'दिक्कत', 'મુશ્કેલી', 'problem', 'issue', 'परेशानी', 'તકલીફ', 'गड़बड़'] },
  { emoji: '🌧️', word: 'बारिश', match: ['बारिश', 'વરસાદ', 'rain', 'मौसम', 'હવામાન', 'weather'] },
  { emoji: '🔥', word: 'गरम', match: ['गरम', 'गर्मी', 'ગરમી', 'hot'] },
  { emoji: '❄️', word: 'ठंड', match: ['ठंड', 'ठंडा', 'ઠંડી', 'cold'] },
  { emoji: '🆕', word: 'नया', match: ['नया', 'નવું', 'new', 'नई'] },
  { emoji: '⏸️', word: 'बंद', match: ['बंद', 'બંધ', 'close', 'closed', 'खत्म', 'પૂરું', 'finish', 'खतम'] },
  { emoji: '▶️', word: 'शुरू', match: ['शुरू', 'શરૂ', 'start', 'चालू', 'ચાલુ'] },
  // sunosathi-specific (heavy in transcripts)
  { emoji: '🧪', word: 'टेस्ट', match: ['टेस्ट', 'ટેસ્ટ', 'test', 'टेस्टिंग', 'testing'] },
  { emoji: '🔊', word: 'आवाज़', match: ['आवाज़', 'आवाज', 'અવાજ', 'voice', 'sound'] },
  { emoji: '🈯', word: 'भाषा', match: ['हिंदी', 'हिन्दी', 'હિન્દી', 'hindi', 'गुजराती', 'ગુજરાતી', 'gujarati', 'english', 'અંગ્રેજી', 'भाषा', 'ભાષા'] },
]

// word → concept index, built once
const INDEX = new Map<string, Concept>()
for (const c of CONCEPTS) {
  for (const m of c.match) INDEX.set(m, c)
}

const WORD_RE = /[ऀ-ॿ઀-૿\w']+/g

/** The swappable renderer input: caption text → ordered concept cards. */
export function conceptsFor(text: string): PictureCard[] {
  const seen = new Set<Concept>()
  const cards: PictureCard[] = []
  const clean = text.replace(/💬|🔊/g, ' ').toLowerCase()
  for (const raw of clean.match(WORD_RE) ?? []) {
    // strip common Hindi/Gujarati punctuation joined to words
    const w = raw.replace(/[।?!.,]/g, '')
    const c = INDEX.get(w)
    if (c && !seen.has(c)) {
      seen.add(c)
      cards.push({ emoji: c.emoji, word: c.word })
      if (cards.length >= 6) break // keep the strip scannable
    }
  }
  if (/[?？]|क्या|શું/.test(text) && !cards.some((c) => c.emoji === '❓')) {
    cards.push({ emoji: '❓', word: '?' })
  }
  return cards
}

const KEY = 'pictureCaptions'

export function pictureCaptionsEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off' // default ON
  } catch {
    return true
  }
}

export function setPictureCaptions(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off')
  } catch { /* ignore */ }
}
