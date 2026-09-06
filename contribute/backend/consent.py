"""The consent contributors give, as data.

The wording lives here rather than in the frontend for one reason: we store
a hash of what the person agreed to, and a hash is only worth storing if it
provably covers the text that was on their screen. Serving the wording from
the same place we hash it makes drift impossible. Change a word, bump the
version, and old records still say exactly what old contributors agreed to.

DRAFT WORDING — Tejas has final say (Track C brief, "What Tejas provides").
Do not present this to NGO partners as settled text.
"""

import hashlib
import json

VERSION = "v1-draft"

# Plain words on purpose. Many contributors will be deaf signers for whom
# written Hindi or English is a second language, so this is written to be
# read quickly, not to be legally impressive.
POINTS = [
    {
        "hi": "मैं जो वीडियो रिकॉर्ड करूँगा/करूँगी, वह और उसमें मेरे हाथ, चेहरे और शरीर की हरकत का डेटा सुनोसाथी के साइन लैंग्वेज AI को सिखाने के लिए इस्तेमाल होगा।",
        "en": "The videos I record, and the hand, face and body movement data taken from them, will be used to train SunoSathi's sign language AI.",
    },
    {
        "hi": "यह डेटा भारतीय सांकेतिक भाषा (ISL) के एक डेटासेट का हिस्सा बन सकता है, जो रिसर्च के लिए इस्तेमाल हो सकता है।",
        "en": "This data may become part of an Indian Sign Language (ISL) dataset that can be used for research.",
    },
    {
        "hi": "मेरा वीडियो एक रिव्यू करने वाला साथी देखेगा, ताकि साइन सही है या नहीं यह जाँचा जा सके।",
        "en": "A reviewer will watch my video to check whether the sign is correct.",
    },
    {
        "hi": "मैं जब चाहूँ अपनी रिकॉर्डिंग हटाने के लिए कह सकता/सकती हूँ। इसके लिए नीचे फ़ोन या ईमेल देना ज़रूरी है।",
        "en": "I can ask for my recordings to be deleted at any time. To do that, I need to leave a phone number or email below.",
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
