# Social media kit — SunoSathi (12 Sep 2026)

Everything needed to open the brand pages. Account creation, passwords and
2-factor must be done by Tejas (Claude cannot create accounts). Sign up with
**namaste@sunosathi.com** everywhere so recovery and notifications land in one
inbox (Cloudflare routes it to Gmail).

## Handle check (public URLs, checked 12 Sep 2026)

| Platform | @sunosathi | @sunosathiapp | Notes |
|---|---|---|---|
| Instagram | — | **DONE 12 Sep 2026: @sunosathiapp** | https://www.instagram.com/sunosathiapp/ — name "SunoSathi सुनोसाथी", bio, avatar set; first post = 9-card how-to carousel (`brand/social/instagram/howto-*.jpg`). Website link can only be added from the mobile app (Edit profile → Links). Threads shares this login. |
| X (Twitter) | **free** | free | take `@sunosathi` |
| Facebook Page | taken by a personal profile "Suno Sathi" (4 friends) | free | create a Page (not a profile), username `sunosathiapp` if `sunosathi` is refused |
| YouTube | TAKEN ("Mera Suno Sathi", music channel) | TAKEN ("SunoSathi", 17 videos, 2 subscribers) | @SunoSathiApp looks like ours (demo videos?) — confirm |
| LinkedIn Page | **DONE 12 Sep 2026** | — | https://www.linkedin.com/company/sunosathi/ (id 145004029). Logo, cover, tagline, About, Mumbai location, "Sign up" button → sunosathi.com/#pilot. Note: LinkedIn's first save after each page load fails with "another admin is editing" — reload and save again. Cover must be JPG, 2256×382 worked. |
| Telegram | taken (a user @sunosathi exists) | taken | our bot is @sunosathibot. Create a public **channel** `t.me/sunosathi_news` or similar for announcements |
| Reddit | **free** | — | `u/sunosathi`; post in r/india, r/deaf, r/accessibility |
| Pinterest | appears taken | appears taken | low priority |
| WhatsApp Channel | n/a | n/a | create from WhatsApp app → Updates → Channels → Create; name "SunoSathi सुनोसाथी" |

Priority order for a deaf/hard-of-hearing audience in India:
**WhatsApp Channel → Instagram → YouTube → Facebook Page → LinkedIn Page → X → Telegram channel → Reddit.**
(Deaf community in India lives on WhatsApp, Instagram and YouTube; ISL content is video-first.)

## Assets (in `brand/social/`, generated from `brand/*.svg` — never redraw)

| File | Use |
|---|---|
| `avatar-orange.png` 1024×1024 | profile picture everywhere (orange tile, cream mark) |
| `avatar-cream.png` 1024×1024 | alternate profile picture (cream, dark mark) |
| `cover-linkedin-1128x191.png` | LinkedIn Page cover |
| `cover-x-1500x500.png` | X header |
| `cover-facebook-1640x624.png` | Facebook Page cover |
| `cover-youtube-2560x1440.png` | YouTube banner (text sits inside the 1546×423 safe zone) |

Regenerate: the `.html` sources sit next to the PNGs; render with headless Chrome
(`--headless=new --screenshot --window-size=WxH`).

## Names and bios

**Display name:** SunoSathi सुनोसाथी
**Tagline:** Your phone number. Their voice, your eyes.
**Website:** https://sunosathi.com
**Category:** App / Accessibility / Assistive technology
**Location:** Mumbai, India

**Short bio (Instagram, X, Threads — under 150 chars):**
Phone calls you can read. Live captions on your own number for deaf and hard of hearing people in India. Hindi, Gujarati, English. Free pilot open.

**Medium bio (Facebook, YouTube, Telegram, Reddit):**
SunoSathi turns your own mobile number into a captioned phone. When someone calls, you read what they say as live text and reply with your voice, by typing, or by tapping pictures. Hindi, Gujarati, English and Hinglish today, more Indian languages coming soon. Built for the 63 million deaf and hard of hearing people in India. Free during the pilot. Join at sunosathi.com

**LinkedIn Page "About":**
SunoSathi (सुनोसाथी) is a captioned phone line for deaf, hard of hearing and non-speaking people in India. Callers dial the user's normal mobile number. The user reads live captions in Hindi, Gujarati, English or Hinglish and replies with their own voice, typed text spoken in a natural Indian voice, or picture tiles that speak full sentences. Calls ring with vibration even when the screen is off, every call is saved as text, and missed calls are sent to Telegram. Powered by Sarvam AI. Started at the GrowthX buildathon in July 2026 and now in free pilot. Join the pilot at sunosathi.com

**First pinned post (all platforms):** reuse the LinkedIn "ready for testing" post from docs/LINKEDIN-TEST-ANNOUNCEMENT.md, without the hashtags on WhatsApp/Telegram.

## Per-platform setup (2 minutes each)

1. **WhatsApp Channel** — WhatsApp → Updates → "+" → New channel → name, bio (short), avatar-orange. Share the channel link on the website footer.
2. **Instagram** — DONE (@sunosathiapp). Remaining, mobile app only: add website link sunosathi.com (Edit profile → Links), switch to Professional account (Settings → Account type) for insights, pin the how-to carousel, add a Story highlight "How to use" from the same cards. Create Threads from this login.
3. **YouTube** — if @SunoSathiApp is ours, just add banner + description; else create a Brand Account from the Google account and claim `@sunosathi_app`.
4. **Facebook Page** — facebook.com/pages/create → name "SunoSathi सुनोसाथी" → category "App page" → username → avatar + cover.
5. **LinkedIn Page** — DONE. Next: follow it from your profile, add it as current employer on your profile (Experience → SunoSathi), repost the announcement from the Page, invite connections (Admin → Invite to follow, 250 credits/month).
6. **X** — x.com/i/flow/signup with namaste@sunosathi.com → handle `sunosathi` → avatar + header + bio + website.
7. **Telegram channel** — Telegram → New Channel → public → link `sunosathi_news` (or `sunosathi_app`) → avatar.
8. **Reddit** — reddit.com/register → `sunosathi` → profile avatar; needs some karma before posting in big subs.

Add all the links to the website footer once created (welcome.html, `<footer>`).
