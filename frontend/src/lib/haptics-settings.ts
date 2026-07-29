// Per-device vibration preferences (localStorage).

export function speechHapticEnabled(): boolean {
  // firm tap when the caller starts speaking — on by default
  return localStorage.getItem('hapticSpeech') !== '0'
}

export function setSpeechHaptic(on: boolean) {
  localStorage.setItem('hapticSpeech', on ? '1' : '0')
}

export function captionHapticEnabled(): boolean {
  // tick per caption — off by default (can feel buzzy)
  return localStorage.getItem('hapticCaption') === '1'
}

export function setCaptionHaptic(on: boolean) {
  localStorage.setItem('hapticCaption', on ? '1' : '0')
}
