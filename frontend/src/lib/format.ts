// Shared display formatting for phone numbers, times and durations.

export function fmtNumber(num: string): string {
  const d = num.replace(/\D/g, '')
  if (d.length === 12 && d.startsWith('91')) return `+91 ${d.slice(2, 7)} ${d.slice(7)}`
  if (d.length === 10) return `${d.slice(0, 5)} ${d.slice(5)}`
  return num
}

export function fmtRelative(ts: number): string {
  const d = new Date(ts * 1000)
  const now = new Date()
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString()
  if (sameDay(d, now)) return time
  const yest = new Date(now)
  yest.setDate(now.getDate() - 1)
  if (sameDay(d, yest)) return `Yesterday ${time}`
  return `${d.toLocaleDateString([], { day: '2-digit', month: 'short' })}, ${time}`
}

export function fmtDuration(s: number): string {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function last10(num: string): string {
  return num.replace(/\D/g, '').slice(-10)
}

export interface NamedContact {
  name: string
  number: string
}

// Resolve a raw number (or name) to a contact name, else a formatted number.
export function resolveDisplay(raw: string, contacts: NamedContact[]): string {
  const key = last10(raw)
  if (!key) return raw
  const hit = contacts.find((c) => last10(c.number) === key)
  return hit ? hit.name : fmtNumber(raw)
}
