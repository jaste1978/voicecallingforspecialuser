// Admin view of contribute.sunosathi.com signups — approve ISL contributors
// from the same admin area as everything else. The backend proxies to the
// contribute service with a service key; no second admin login needed.

import { useEffect, useState } from 'react'
import { authFetch } from '../lib/auth'

interface ContribUser {
  id: string
  name: string
  identifier: string
  role: string
  status: string
  note: string
  clips: number
  created_at: number
}

const STATUS_BADGE: Record<string, string> = {
  pending: '⏳ pending',
  approved: '✅ approved',
  rejected: '🚫 rejected',
  suspended: '⛔ suspended',
}

export default function ContributePage() {
  const [users, setUsers] = useState<ContribUser[] | null>(null)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState('')

  const load = () => {
    authFetch('/api/contrib/users')
      .then(async (resp) => {
        if (resp.status === 403) {
          setError('This page is for the admin account only.')
          return
        }
        const d = await resp.json()
        if (!resp.ok) {
          setError(d.error || 'Could not reach the contribute platform.')
          return
        }
        setUsers(d.users)
      })
      .catch(() => setError('Could not load — check your connection.'))
  }

  useEffect(load, [])

  const setStatus = async (u: ContribUser, status: string) => {
    setBusyId(u.id)
    try {
      const resp = await authFetch(`/api/contrib/users/${u.id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      if (resp.ok) {
        setUsers((prev) => prev?.map((x) => (x.id === u.id ? { ...x, status } : x)) ?? null)
      } else {
        const d = await resp.json().catch(() => ({}))
        setError(d.error || 'Update failed — try again.')
      }
    } finally {
      setBusyId('')
    }
  }

  if (error) return <main className="stub">{error}</main>
  if (!users) return <main className="stub">Loading…</main>

  const pending = users.filter((u) => u.status === 'pending').length

  return (
    <main className="settings-page">
      <h3 className="monitor-heading">
        {users.length} contributor account{users.length === 1 ? '' : 's'}
        {pending > 0 && <> · {pending} waiting</>}
      </h3>
      {users.map((u) => (
        <section className="setting-block" key={u.id}>
          <strong>{u.name}</strong> <span>{STATUS_BADGE[u.status] || u.status}</span>
          {u.role !== 'contributor' && <> · {u.role}</>}
          <p className="idle-hint" style={{ textAlign: 'left' }}>
            {u.identifier}
            {' · '}
            {u.clips} clip{u.clips === 1 ? '' : 's'}
            {' · '}
            {new Date(u.created_at * 1000).toLocaleString([], {
              day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
            })}
          </p>
          {u.note && <p style={{ marginTop: 6 }}>💬 {u.note}</p>}
          <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
            {u.status !== 'approved' && (
              <button className="bigbtn start" disabled={busyId === u.id}
                style={{ minHeight: 40, padding: '0 16px', flex: '0 0 auto' }}
                onClick={() => setStatus(u, 'approved')}>
                ✅ Approve
              </button>
            )}
            {u.status === 'pending' && (
              <button className="promptbtn" disabled={busyId === u.id}
                style={{ flex: '0 0 auto' }}
                onClick={() => setStatus(u, 'rejected')}>
                Reject
              </button>
            )}
            {u.status === 'approved' && (
              <button className="promptbtn" disabled={busyId === u.id}
                style={{ flex: '0 0 auto' }}
                onClick={() => setStatus(u, 'suspended')}>
                Suspend
              </button>
            )}
          </div>
        </section>
      ))}
      {users.length === 0 && (
        <p className="idle-hint">No contributor signups yet — share contribute.sunosathi.com!</p>
      )}
    </main>
  )
}
