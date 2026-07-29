import { PhoneIcon } from './icons'

// Deterministic warm hue per name so the same person always gets the same color.
const AVATAR_HUES = [16, 30, 45, 95, 165, 200, 345]

export function avatarColor(name: string): string {
  let h = 0
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 997
  return `hsl(${AVATAR_HUES[h % AVATAR_HUES.length]} 48% 42%)`
}

interface AvatarProps {
  name: string
  variant?: '' | 'small' | 'tiny'
}

// Shows the person's initial, or a handset icon when we only know a number.
export default function Avatar({ name, variant = '' }: AvatarProps) {
  const ch = (name || '').trim().charAt(0)
  const isNumber = !ch || /[0-9+]/.test(ch)
  const iconSize = variant === '' ? 46 : 20
  return (
    <div
      className={`avatar${variant ? ` ${variant}` : ''}`}
      style={{ background: avatarColor(name) }}
    >
      {isNumber ? <PhoneIcon size={iconSize} /> : ch.toUpperCase()}
    </div>
  )
}
