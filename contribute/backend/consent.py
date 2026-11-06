"""The consent contributors give, as data.

The wording lives here rather than in the frontend for one reason: we store
a hash of what the person agreed to, and a hash is only worth storing if it
provably covers the text that was on their screen. Serving the wording from
the same place we hash it makes drift impossible. Change a word, bump the
version, and old records still say exactly what old contributors agreed to.

Version 1 is settled wording, signed off on 6 Nov 2026. Four decisions are
baked into it and changing any of them means a new version, not an edit:
the data stays inside SunoSathi, the video is never shown to users, the app
shows a drawn figure instead, and contributors are adults.

Changing a word changes the hash, which is the point — every contribution
stores the hash of the text that was actually on screen, so an old record
still says exactly what an old contributor agreed to.
"""

import hashlib
import json

VERSION = "v1"

# Plain words on purpose. Many contributors will be deaf signers for whom
# written Hindi or English is a second language, so this is written to be
# read quickly, not to be legally impressive.
POINTS = [
    {
        "hi": "मैं जो वीडियो रिकॉर्ड करूँगा/करूँगी, वह और उसमें मेरे हाथ, चेहरे और शरीर की हरकत का डेटा सुनोसाथी रखेगा।",
        "en": "SunoSathi will keep the videos I record, and the hand, face and body movement data taken from them.",
    },
    {
        "hi": "इसका इस्तेमाल सिर्फ़ सुनोसाथी के साइन लैंग्वेज AI को सिखाने के लिए होगा, ताकि ऐप बहरे लोगों को साइन दिखा सके। यह डेटा किसी और को नहीं दिया जाएगा और न बेचा जाएगा।",
        "en": "It will be used only to teach SunoSathi's sign language AI, so the app can show signs to Deaf people. This data will not be given to anyone else, and will not be sold.",
    },
    {
        # The reassurance that matters most to a Deaf contributor, and the one
        # the architecture actually keeps: only pose keypoints are published,
        # the video never leaves the private bucket.
        "hi": "ऐप में मेरा वीडियो किसी को नहीं दिखेगा। लोगों को सिर्फ़ मेरी हरकत से बनी एक रेखा-आकृति दिखेगी। वीडियो सिर्फ़ जाँच करने वाला साथी देखेगा, यह देखने के लिए कि साइन सही है।",
        "en": "My video will not be shown to anyone in the app. People will only see a line figure drawn from my movements. The video is watched only by a reviewer, to check the sign is correct.",
    },
    {
        # Said plainly because it is true, and because a promise that cannot
        # be kept is worse than a limit that is admitted up front.
        "hi": "मैं जब चाहूँ रिकॉर्ड करना बंद कर सकता/सकती हूँ, और अपनी रिकॉर्डिंग हटाने के लिए कह सकता/सकती हूँ — namaste@sunosathi.com पर। जो साइन ऐप में आ चुका है उसे हम अगले अपडेट से हटा देंगे, पर जो ऐप लोगों के फ़ोन में पहले से है वहाँ से नहीं हटा सकते।",
        "en": "I can stop recording whenever I want, and can ask for my recordings to be deleted — at namaste@sunosathi.com. A sign already in the app will be removed in the next update, but we cannot remove it from copies already installed on people's phones.",
    },
]

CHECKS = [
    {
        "id": "agree",
        "required": True,
        "hi": "मैं ऊपर की बातें समझ गया/गई हूँ और सहमत हूँ।",
        "en": "I have understood the points above and I agree.",
    },
    {
        "id": "adult",
        "required": True,
        "hi": "मेरी उम्र 18 साल या उससे ज़्यादा है।",
        "en": "I am 18 years old or older.",
    },
    {
        "id": "credit",
        "required": False,
        "hi": "मेरा नाम योगदान देने वालों की सूची में दिखाया जा सकता है।",
        "en": "My name may be shown on the contributors list.",
    },
]

TITLE = {"hi": "रिकॉर्डिंग से पहले", "en": "Before you record"}


def document() -> dict:
    return {"version": VERSION, "title": TITLE, "points": POINTS, "checks": CHECKS,
            "hash": text_hash()}


def text_hash() -> str:
    """Stable digest of the exact wording. Key order is fixed by json.dumps
    with sort_keys, so the hash tracks the words and nothing else."""
    payload = json.dumps(
        {"version": VERSION, "title": TITLE, "points": POINTS, "checks": CHECKS},
        sort_keys=True, ensure_ascii=False,
    )
    return hashlib.sha256(payload.encode()).hexdigest()[:32]
