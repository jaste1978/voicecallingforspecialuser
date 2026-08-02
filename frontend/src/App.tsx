import { useEffect } from 'react'
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom'
import { getToken } from './lib/auth'
import { syncNativeAuth } from './lib/native-bridge'
import { startVersionWatch } from './lib/version-watch'
import LoginPage from './pages/LoginPage'
import CaptionsPage from './pages/CaptionsPage'
import CallPage from './pages/CallPage'
import HistoryPage from './pages/HistoryPage'
import ContactsPage from './pages/ContactsPage'
import ModelsPage from './pages/SettingsPage'
import SettingsTab from './pages/AdminPage'
import RingtonePage from './pages/RingtonePage'
import MonitorPage from './pages/MonitorPage'
import WaitlistPage from './pages/WaitlistPage'
import UsersPage from './pages/UsersPage'
import CostsPage from './pages/CostsPage'
import StartPage from './pages/StartPage'
import TabBar from './components/TabBar'

const TITLES: Record<string, string> = {
  '/': 'Calls',
  '/call': 'Calls',
  '/contacts': 'Contacts',
  '/settings': 'Settings',
  '/captions': 'Caption Tester',
  '/history': 'Call History',
  '/models': 'AI Models',
  '/ringtone': 'Ring & Vibration',
  '/monitor': 'Call Monitor',
  '/waitlist': 'Pilot Waitlist',
  '/users': 'Users & Numbers',
  '/costs': 'Costs',
}

// main tab roots — no back button, tab bar visible
const TAB_ROOTS = new Set(['/', '/call', '/contacts', '/settings'])
// sub-pages that belong to the Settings tab
const SETTINGS_CHILDREN = new Set([
  '/captions', '/history', '/models', '/ringtone', '/monitor', '/waitlist', '/users', '/costs',
])

export default function App() {
  const navigate = useNavigate()
  const { pathname } = useLocation()

  useEffect(() => {
    startVersionWatch()
  }, [])

  useEffect(() => {
    const authed = Boolean(getToken())
    // keep the native shell's background ring service in sync with login
    syncNativeAuth(getToken())
    if (!authed && pathname !== '/login' && pathname !== '/start') {
      navigate('/start', { replace: true })
    } else if (authed && pathname === '/start') {
      navigate('/', { replace: true })
    }
  }, [pathname, navigate])

  if (pathname === '/start') {
    return (
      <div className="app">
        <Routes>
          <Route path="/start" element={<StartPage />} />
        </Routes>
      </div>
    )
  }

  if (pathname === '/login') {
    return (
      <div className="app">
        <header className="topbar">
          <h1>SunoSathi</h1>
        </header>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
        </Routes>
      </div>
    )
  }

  const isTabRoot = TAB_ROOTS.has(pathname)

  return (
    <div className="app">
      <header className="topbar">
        {!isTabRoot && (
          <button
            className="iconbtn"
            aria-label="Back"
            onClick={() => navigate(SETTINGS_CHILDREN.has(pathname) ? '/settings' : '/')}
          >
            ←
          </button>
        )}
        <h1>{TITLES[pathname] ?? 'SunoSathi'}</h1>
      </header>
      <div className="content">
        <Routes>
          <Route path="/" element={<CallPage />} />
          <Route path="/call" element={<CallPage />} />
          <Route path="/contacts" element={<ContactsPage />} />
          <Route path="/settings" element={<SettingsTab />} />
          <Route path="/captions" element={<CaptionsPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/models" element={<ModelsPage />} />
          <Route path="/ringtone" element={<RingtonePage />} />
          <Route path="/monitor" element={<MonitorPage />} />
          <Route path="/waitlist" element={<WaitlistPage />} />
          <Route path="/users" element={<UsersPage />} />
          <Route path="/costs" element={<CostsPage />} />
        </Routes>
      </div>
      <TabBar />
    </div>
  )
}
