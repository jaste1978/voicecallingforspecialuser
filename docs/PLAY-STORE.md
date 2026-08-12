# Play Store launch kit — SunoSathi

Everything needed to publish. Files live in `play-store/`; the signed bundle is
`SunoSathi-1.4.aab` at the repo root.

## ⚠️ Two things to know first

1. **Personal accounts must run a closed test first.** If your Play Console
   account is registered as an *individual* (not an organisation), Google
   requires a closed test with at least **12 testers opted-in continuously for
   14 days** before you can apply for production access. Plan for this: upload
   to **Closed testing** first, recruit testers (family, colleagues, the pilot
   users, WhatsApp groups), then apply for production. Organisation accounts
   skip this entirely.
2. **Never lose `mobile/android/app/upload.keystore` + `mobile/android/keystore.properties`.**
   They sign every future update (they are gitignored — back both files up to a
   password manager / drive now). If ever lost, Play can reset the upload key,
   but it takes days.

## Console walkthrough

1. **Create app**: Play Console → Create app → name `SunoSathi`, default
   language `English (India)`, App, Free.
2. **Set up your app** checklist (Dashboard):
   - **Privacy policy**: `https://sunosathi.com/privacy` (live).
   - **App access**: "All functionality is available without special access"
     is WRONG for us — choose *All or some functionality is restricted*, add
     credentials for review: create a demo user (see below).
   - **Ads**: No ads.
   - **Content rating**: questionnaire → category *Utility/Communication*;
     answer No to violence/sex/etc. Expect rating: Everyone / 3+.
   - **Target audience**: 18 and over (simplest; avoids child-safety review).
   - **News app**: No. **COVID app**: No.
   - **Data safety** (answers below).
   - **Government app**: No. **Financial features**: none.
3. **Store listing** (copy below, images in `play-store/`).
4. **Upload**: Testing → Closed testing → Create track/release → upload
   `SunoSathi-1.4.aab` → Google will offer *Play App Signing* — accept
   (Google holds the app key, your keystore is the upload key).
5. **Permissions declaration**: the app uses a **foreground service
   (dataSync)** — Console will ask for a declaration + demo video. Say: keeps a
   connection open so deaf users' incoming calls can ring the device; record a
   30-second screen video of a call ringing with the app in background (I can
   stage a test call for the recording).
6. Add testers (email list or Google Group) → share the opt-in link → after 14
   days with 12+ testers, Dashboard shows **Apply for production**.

### Demo account for Google reviewers
Create a dedicated user (do NOT give them your admin): email
`playreview@sunosathi.com`-style account via Users & Numbers, register a spare
number, note the password in the App access form. Reviewers must be able to log
in and see the Calls screen.

## Store listing copy

**App name** (30 chars max):
`SunoSathi — Captioned Calls`

**Short description** (80 chars max):
`Read your phone calls live in Hindi, Gujarati & English. Reply your way.`

**Full description** (4000 chars max):

```
SunoSathi (सुनोसाथी) gives deaf and hard-of-hearing people their phone calls
back — on their OWN mobile number.

Callers dial your normal number. You read what they say as live captions, and
you reply your way:

🗣 Speak — if you can talk, just talk
⌨️ Type — what you type is spoken to the caller in a natural voice
🖼 Tap pictures — ready-made phrases (yes / no / send location / call later)
   spoken for you with one tap

HOW IT WORKS
1. Sign up and get your SunoSathi forwarding code
2. Dial the code once from your phone (**21*…#) — done
3. Every call to your number now rings in SunoSathi with live captions

FEATURES
• Live captions in Hindi, Gujarati, English & Hinglish — auto-detected
• Reply by voice, typing, or picture board
• Choose the voice callers hear (male/female options)
• Full call history with transcripts you can re-read anytime
• Caption accuracy score on every call
• Saved contacts, call-back from history
• Noise filtering — TV/traffic sounds don't become junk captions
• Works on your existing SIM & number — no new number needed

WHO IT'S FOR
• Deaf and hard-of-hearing users
• Late-deafened adults and seniors losing hearing
• Anyone who wants to READ calls they can't hear

PRIVACY
Your calls are processed only to create your captions (speech recognition by
Sarvam AI, India). Recordings and transcripts stay in your account and you can
delete them. No ads, no data selling. Full policy: https://sunosathi.com/privacy

SETUP HELP
Step-by-step picture guide: https://sunosathi.com/guide
WhatsApp support: +91 98190 95969

आपके कान, आपकी आवाज़ — SunoSathi
```

**Graphics** (all in `play-store/`):
- App icon 512×512: `icon-512.png`
- Feature graphic 1024×500: `feature-1024x500.png`
- Phone screenshots 540×960 (upload at least 4, order):
  `welcome.png`, `ring.png`, `captions.png`, `speak.png`, `board.png`,
  `home.png`, `login.png`, `settings.png`

**Category**: App → Communication. Tags: accessibility, captions.
**Contact email**: tnlangalia@gmail.com · **Website**: https://sunosathi.com

## Data safety form answers

Data collected & shared:
| Question | Answer |
|---|---|
| Does your app collect or share user data? | Yes |
| **Personal info → Name, Email** | Collected, not shared. Required. Account management. Encrypted in transit. Deletion via email request. |
| **Personal info → Phone number** | Collected, not shared. Required. App functionality (call routing). |
| **Audio → Voice or sound recordings** | Collected, **shared** (with service provider Sarvam AI for speech-to-text). Required. App functionality. Encrypted in transit. User can request deletion. |
| **Messages → Other in-app messages** (typed-to-speak) | Collected, shared with service provider (TTS). App functionality. |
| **Contacts** | Collected (only contacts the user adds in-app; phone book never read), not shared. Optional. App functionality. |
| Data encrypted in transit? | Yes |
| Deletion mechanism? | Yes — email request (and in-app call deletion) |

Foreground service declaration: type `dataSync` — maintains the incoming-call
socket so calls ring while the app is backgrounded; core accessibility function.

## After approval
- Add the Play Store badge/link to sunosathi.com and /guide
- Retire the APK sideload flow from the guide (keep as fallback)
- Roadmap: switch closed-test track to production once the 14-day window passes
