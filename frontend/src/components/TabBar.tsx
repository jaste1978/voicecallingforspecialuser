import { useLocation, useNavigate } from 'react-router-dom'

const TABS = [
  {
    path: '/',
    label: 'Home',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 11l8-7 8 7" />
        <path d="M6 9.5V20h12V9.5" />
        <path d="M10 20v-6h4v6" />
      </svg>
    ),
  },
  {
    path: '/calls',
    label: 'Calls',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" />
      </svg>
    ),
  },
  {
    path: '/contacts',
    label: 'Contacts',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="9" cy="8" r="3.5" />
        <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
        <path d="M16 8h6M19 5v6" />
      </svg>
    ),
  },
  {
    path: '/settings',
    label: 'Settings',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7 7 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.06-.4.1-.8.1-1.2Z" />
      </svg>
    ),
  },
]

export default function TabBar() {
  const navigate = useNavigate()
  const { pathname } = useLocation()

  return (
    <nav className="tabbar" aria-label="Main">
      {TABS.map((t) => {
        const active =
          t.path === '/'
            ? pathname === '/'
            : t.path === '/calls'
              ? pathname === '/calls' || pathname === '/call'
              : pathname.startsWith(t.path)
        return (
          <button
            key={t.path}
            className={`tab${active ? ' active' : ''}`}
            onClick={() => navigate(t.path)}
            aria-label={t.label}
          >
            {t.icon}
            <span>{t.label}</span>
          </button>
        )
      })}
    </nav>
  )
}
