// Picture-talk board: tap a tile, the caller hears it. Built for users who
// sign rather than type — every tile is a picture first, words second.

interface Tile {
  emoji: string
  label: string
  say: string
}

interface Category {
  name: string
  tiles: Tile[]
}

export const BOARD: Category[] = [
  {
    name: 'जवाब · Answers',
    tiles: [
      { emoji: '👍', label: 'हाँ', say: 'हाँ।' },
      { emoji: '👎', label: 'ना', say: 'नहीं।' },
      { emoji: '👌', label: 'ठीक है', say: 'ठीक है।' },
      { emoji: '🙏', label: 'धन्यवाद', say: 'धन्यवाद।' },
      { emoji: '🤔', label: 'पता नहीं', say: 'मुझे पता नहीं।' },
      { emoji: '❤️', label: 'प्यार', say: 'आपसे बात करके अच्छा लगा।' },
    ],
  },
  {
    name: 'बातचीत · Talk',
    tiles: [
      { emoji: '✋', label: 'रुकिए', say: 'कृपया एक क्षण रुकिए।' },
      { emoji: '🔁', label: 'दोबारा', say: 'कृपया अपनी बात दोबारा कहिए।' },
      { emoji: '🐢', label: 'धीरे बोलें', say: 'कृपया थोड़ा धीरे बोलिए।' },
      { emoji: '👂', label: 'सुन नहीं सकती', say: 'मैं सुन नहीं सकती, आपकी बात पढ़ रही हूँ। कृपया बोलते रहिए।' },
      { emoji: '❓', label: 'कौन?', say: 'आप कौन बोल रहे हैं?' },
      { emoji: '📞', label: 'बाद में', say: 'मैं आपको बाद में call करती हूँ।' },
    ],
  },
  {
    name: 'समय · Time',
    tiles: [
      { emoji: '🕐', label: 'अभी', say: 'अभी।' },
      { emoji: '⏳', label: 'थोड़ी देर में', say: 'थोड़ी देर में।' },
      { emoji: '🌅', label: 'कल सुबह', say: 'कल सुबह।' },
      { emoji: '🌙', label: 'आज रात', say: 'आज रात।' },
      { emoji: '📅', label: 'कल', say: 'कल।' },
      { emoji: '🗓️', label: 'रविवार', say: 'रविवार को।' },
    ],
  },
  {
    name: 'जगह · Places',
    tiles: [
      { emoji: '🏠', label: 'घर', say: 'मैं घर पर हूँ।' },
      { emoji: '🏢', label: 'काम पर', say: 'मैं काम पर हूँ।' },
      { emoji: '🚌', label: 'रास्ते में', say: 'मैं रास्ते में हूँ।' },
      { emoji: '🏥', label: 'अस्पताल', say: 'अस्पताल।' },
      { emoji: '🛒', label: 'बाज़ार', say: 'बाज़ार में हूँ।' },
      { emoji: '🛕', label: 'मंदिर', say: 'मंदिर में हूँ।' },
    ],
  },
  {
    name: 'ज़रूरत · Needs',
    tiles: [
      { emoji: '🍽️', label: 'खाना', say: 'खाना।' },
      { emoji: '💧', label: 'पानी', say: 'पानी।' },
      { emoji: '💊', label: 'दवाई', say: 'दवाई चाहिए।' },
      { emoji: '🆘', label: 'मदद', say: 'मुझे मदद चाहिए।' },
      { emoji: '💰', label: 'पैसे', say: 'पैसे।' },
      { emoji: '🚪', label: 'दरवाज़ा', say: 'दरवाज़े पर आइए।' },
    ],
  },
]

interface SpeakBoardProps {
  onSay: (text: string) => void
  onClose: () => void
}

export default function SpeakBoard({ onSay, onClose }: SpeakBoardProps) {
  return (
    <div className="board-sheet" role="dialog" aria-label="Picture talk board">
      <div className="board-head">
        <b>🖼️ Picture talk</b>
        <button className="iconbtn" aria-label="Close board" onClick={onClose}>✕</button>
      </div>
      <div className="board-scroll">
        {BOARD.map((cat) => (
          <div key={cat.name}>
            <p className="board-cat">{cat.name}</p>
            <div className="board-grid">
              {cat.tiles.map((t) => (
                <button
                  key={t.label}
                  className="board-tile"
                  onClick={() => onSay(t.say)}
                >
                  <span className="board-emoji">{t.emoji}</span>
                  <span className="board-label">{t.label}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
