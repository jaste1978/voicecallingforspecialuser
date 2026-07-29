import { useEffect } from 'react'
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom'
import { getToken } from './lib/auth'
import LoginPage from './pages/LoginPage'
import HomePage from './pages/HomePage'
import CaptionsPage from './pages/CaptionsPage'
import CallPage from './pages/CallPage'
import HistoryPage from './pages/HistoryPage'
import ContactsPage from './pages/ContactsPage'
import SettingsPage from './pages/SettingsPage'
import AdminPage from './pages/AdminPage'
import RingtonePage from './pages/RingtonePage'
import MonitorPage from './pages/MonitorPage'
import WaitlistPage from './pages/WaitlistPage'

const TITLES: Record<string, string> = {
  '/': 'SunoSathi',
  '/captions': 'Caption Tester',
  '/call': 'Calls',
  '/contacts': 'New Call',
  '/history': 'Call History',
  '/settings': 'AI Models',
  '/admin': 'Admin',
  '/ringtone': 'Ring & Vibration',
  '/monitor': 'Call Monitor',
  '/waitlist': 'Pilot Waitlist',
}

// pages that belong to the admin area go back to /admin, others to home
const ADMIN_CHILDREN = new Set(['/captions', '/history', '/settings', '/ringtone', '/monitor', '/waitlist'])

export default function App() {
  const navigate = useNavigate()
  const { pathname } = useLocation()

  // the whole app requires login
  useEffect(() => {
    if (!getToken() && pathname !== '/login') {
      navigate('/login', { replace: true })
    }
  }, [pathname, navigate])

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

  return (
    <div className="app">
      <header className="topbar">
        {pathname !== '/' && (
          <button
            className="iconbtn"
            aria-label="Back"
            onClick={() => navigate(ADMIN_CHILDREN.has(pathname) ? '/admin' : '/')}
          >
            ←
          </button>
        )}
        <h1>{TITLES[pathname] ?? 'SunoSathi'}</h1>
        {pathname === '/' && (
          <button
            className="iconbtn"
            aria-label="Admin"
            onClick={() => navigate('/admin')}
          >
            ⚙️
          </button>
        )}
      </header>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/captions" element={<CaptionsPage />} />
        <Route path="/call" element={<CallPage />} />
        <Route path="/contacts" element={<ContactsPage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/ringtone" element={<RingtonePage />} />
        <Route path="/monitor" element={<MonitorPage />} />
        <Route path="/waitlist" element={<WaitlistPage />} />
      </Routes>
    </div>
  )
}
