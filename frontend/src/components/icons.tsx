// Shared stroke-icon set (24x24 viewBox, currentColor) so the app has one
// visual language instead of platform-dependent emoji.

interface IconProps {
  size?: number
  strokeWidth?: number
}

function base(size: number, strokeWidth: number) {
  return {
    viewBox: '0 0 24 24',
    width: size,
    height: size,
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }
}

const HANDSET = 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2'

export function PhoneIcon({ size = 24, strokeWidth = 2 }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)}>
      <path d={HANDSET} />
    </svg>
  )
}

export function PhoneIncomingIcon({ size = 24, strokeWidth = 2 }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)}>
      <path d={HANDSET} />
      <path d="M21 3l-5 5M16 4v4h4" />
    </svg>
  )
}

export function PhoneOutgoingIcon({ size = 24, strokeWidth = 2 }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)}>
      <path d={HANDSET} />
      <path d="M16 8l5-5M17 3h4v4" />
    </svg>
  )
}

export function PhoneMissedIcon({ size = 24, strokeWidth = 2 }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)}>
      <path d={HANDSET} />
      <path d="M16 3l5 5M21 3l-5 5" />
    </svg>
  )
}

export function MicIcon({ size = 24, strokeWidth = 2 }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)}>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  )
}

export function MicOffIcon({ size = 24, strokeWidth = 2 }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)}>
      <path d="M9 9v5a3 3 0 0 0 5.2 2M15 10V6a3 3 0 0 0-5.6-1.5" />
      <path d="M5 11a7 7 0 0 0 11.4 5.4M19 11a7 7 0 0 1-.4 2.3M12 18v3" />
      <path d="M3 3l18 18" />
    </svg>
  )
}

export function TrashIcon({ size = 24, strokeWidth = 2 }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)}>
      <path d="M4 7h16M10 4h4M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13M10 11v6M14 11v6" />
    </svg>
  )
}

export function XIcon({ size = 24, strokeWidth = 2 }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  )
}

export function BellIcon({ size = 24, strokeWidth = 2 }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)}>
      <path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6" />
      <path d="M10 19a2 2 0 0 0 4 0" />
    </svg>
  )
}

export function CaptionsIcon({ size = 24, strokeWidth = 2 }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)}>
      <path d="M21 12a8 8 0 0 1-8 8H4l2-3a8 8 0 1 1 15-5Z" />
      <path d="M8 11h8M8 14.5h5" />
    </svg>
  )
}

export function BotIcon({ size = 24, strokeWidth = 2 }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)}>
      <rect x="5" y="8" width="14" height="11" rx="3" />
      <path d="M12 8V4M12 4h.01" />
      <circle cx="9.5" cy="13" r="0.8" fill="currentColor" />
      <circle cx="14.5" cy="13" r="0.8" fill="currentColor" />
      <path d="M9.5 16.5h5" />
    </svg>
  )
}

export function ChartIcon({ size = 24, strokeWidth = 2 }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)}>
      <path d="M4 20V10M10 20V4M16 20v-8M21 20H3" />
    </svg>
  )
}

export function InboxIcon({ size = 24, strokeWidth = 2 }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)}>
      <path d="M4 13l2.4-7.2A2 2 0 0 1 8.3 4.5h7.4a2 2 0 0 1 1.9 1.3L20 13" />
      <path d="M4 13v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4h-5a3 3 0 0 1-6 0H4Z" />
    </svg>
  )
}

export function SpeakerIcon({ size = 24, strokeWidth = 2 }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)}>
      <path d="M11 5 6.5 8.5H3v7h3.5L11 19V5Z" />
      <path d="M15 9a4.2 4.2 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11" />
    </svg>
  )
}

export function SpeakerOffIcon({ size = 24, strokeWidth = 2 }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)}>
      <path d="M11 5 6.5 8.5H3v7h3.5L11 19V5Z" />
      <path d="M15.5 9.5l5 5M20.5 9.5l-5 5" />
    </svg>
  )
}

// The SunoSathi brand mark: the listening curl catching three caption
// lines (chosen logo "06 — सुनो, the listening hand").
export function LogoMark({ size = 24 }: IconProps) {
  return (
    <svg viewBox="0 0 144 118" width={size} height={size * 0.82} fill="none">
      <path d="M100 12 C120 19 131 37 131 57 C131 86 111 106 84 106 C64 106 51 95 46 79" stroke="currentColor" strokeWidth="9" strokeLinecap="round" />
      <path d="M46 79 C44 66 51 57 62 57 C73 57 80 66 78 77" stroke="currentColor" strokeWidth="9" strokeLinecap="round" />
      <rect x="8" y="24" width="36" height="8" rx="4" fill="currentColor" />
      <rect x="16" y="42" width="28" height="8" rx="4" fill="currentColor" opacity=".85" />
      <rect x="24" y="60" width="20" height="8" rx="4" fill="currentColor" opacity=".65" />
    </svg>
  )
}

export function RupeeIcon({ size = 24, strokeWidth = 2 }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)}>
      <path d="M6 3h12M6 8h12M6 3c7 0 8 3.5 8 5 0 2.5-2.5 5-8 5l8 8" />
    </svg>
  )
}

export function NewCallIcon({ size = 24, strokeWidth = 2 }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)}>
      <path d={HANDSET} />
      <path d="M15 5h6M18 2v6" />
    </svg>
  )
}
