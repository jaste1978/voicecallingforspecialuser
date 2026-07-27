// Per-device ringtone preferences (localStorage).

export function ringtoneEnabled(): boolean {
  return localStorage.getItem('ringtoneEnabled') !== '0'
}

export function setRingtoneEnabled(on: boolean) {
  localStorage.setItem('ringtoneEnabled', on ? '1' : '0')
}

export function ringtoneVolume(): number {
  const v = Number(localStorage.getItem('ringtoneVolume'))
  return Number.isFinite(v) && v > 0 ? Math.min(v, 1) : 0.5
}

export function setRingtoneVolume(v: number) {
  localStorage.setItem('ringtoneVolume', String(Math.max(0.05, Math.min(v, 1))))
}
