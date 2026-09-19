import { useState } from 'react'
import { authFetch } from '../lib/auth'
import { track } from '../lib/analytics'

export default function TestCallButton() {
  const [testState, setTestState] = useState<'idle' | 'calling' | 'busy'>('idle')

  async function startTestCall() {
    setTestState('calling')
    track('test_call')
    try {
      const resp = await authFetch('/api/test-call', { method: 'POST' })
      if (resp.status === 409) {
        setTestState('busy')
        setTimeout(() => setTestState('idle'), 3000)
        return
      }
      // the call rings in a few seconds; callStore auto-navigates to /calls
      setTimeout(() => setTestState('idle'), 20000)
    } catch {
      setTestState('idle')
    }
  }

  return (
    <button
      className="home-btn testcall"
      disabled={testState === 'calling'}
      onClick={() => void startTestCall()}
    >
      <span className="emoji icon">📞</span>
      <span>
        {testState === 'calling'
          ? 'Calling you…'
          : testState === 'busy'
            ? 'A call is already running'
            : 'Try a test call'}
        <small>
          {testState === 'calling'
            ? 'SunoSathi is calling — accept and watch the captions!'
            : 'SunoSathi calls you & speaks — see live captions in action'}
        </small>
      </span>
    </button>
  )
}
