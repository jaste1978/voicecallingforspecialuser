import { Routes, Route, useNavigate, useLocation } from 'react-router-dom'
import HomePage from './pages/HomePage'
import CaptionsPage from './pages/CaptionsPage'
import CallPage from './pages/CallPage'
import AlertsPage from './pages/AlertsPage'
import HistoryPage from './pages/HistoryPage'
import ContactsPage from './pages/ContactsPage'
import SettingsPage from './pages/SettingsPage'

const TITLES: Record<string, string> = {
  '/': 'SunoSathi',
  '/captions': 'Live Captions',
  '/call': 'Calls',
  '/alerts': 'Sound Alerts',
  '/history': 'Call History',
  '/contacts': 'New Call',
  '/settings': 'Settings',
}

export default function App() {
  const navigate = useNavigate()
  const { pathname } = useLocation()

  return (
    <div className="app">
      <header className="topbar">
        {pathname !== '/' && (
          <button className="iconbtn" aria-label="Back" onClick={() => navigate('/')}>
            ←
          </button>
        )}
        <h1>{TITLES[pathname] ?? 'SunoSathi'}</h1>
        {pathname === '/' && (
          <button
            className="iconbtn"
            aria-label="Settings"
            onClick={() => navigate('/settings')}
          >
            ⚙️
          </button>
        )}
      </header>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/captions" element={<CaptionsPage />} />
        <Route path="/call" element={<CallPage />} />
        <Route path="/alerts" element={<AlertsPage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/contacts" element={<ContactsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
    </div>
  )
}
