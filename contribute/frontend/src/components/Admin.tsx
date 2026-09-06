// Who gets in. The admin's whole job on this screen is the pending queue —
// everything else is there so a decision can be made without leaving it.

import { useCallback, useEffect, useState } from 'react'
import { adminUsers, setUserStatus } from '../lib/api'
import type { AdminUser, Role, Status } from '../lib/api'

const FILTERS: { key: string; label: string }[] = [
  { key: 'pending', label: 'Waiting' },
  { key: 'approved', label: 'Approved' },
  { key: '', label: 'Everyone' },
]

interface Props {
  /** The signed-in admin, so the screen never offers them a button that
   *  locks them out — the server refuses it, and an action that always
   *  errors is worse than no action. */
  selfId: string
  onLeave: () => void
}

export default function Admin({ selfId, onLeave }: Props) {
  const [filter, setFilter] = useState('pending')
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [acting, setActing] = useState('')

  const load = useCallback(async (status: string) => {
    setLoading(true)
    setError('')
    try {
      setUsers(await adminUsers(status))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load(filter) }, [filter, load])

  const act = async (id: string, status: Status, role?: Role) => {
    setActing(id)
    setError('')
    try {
      await setUserStatus(id, status, role)
      await load(filter)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setActing('')
    }
  }

  const waiting = users.filter((u) => u.status === 'pending').length

  return (
    <div className="pane admin">
      <div className="admin-head">
        <h1>Contributors</h1>
        <button className="link" onClick={onLeave}>← back</button>
      </div>

      <div className="tabs">
        {FILTERS.map((f) => (
          <button key={f.key} className={filter === f.key ? 'on' : ''}
                  onClick={() => setFilter(f.key)}>
            {f.label}{f.key === 'pending' && waiting > 0 ? ` · ${waiting}` : ''}
          </button>
        ))}
      </div>

      {error && <p className="err">{error}</p>}
      {loading && <p className="muted">Loading…</p>}
      {!loading && users.length === 0 && (
        <p className="muted">Nobody here.{filter === 'pending' && ' Queue is clear.'}</p>
      )}

      <ul className="users">
        {users.map((u) => (
          <li key={u.id} className={`user ${u.status}`}>
            <div className="user-top">
              <span className="user-name">{u.name}</span>
              <span className={`pill ${u.status}`}>{u.status}</span>
              {u.role !== 'contributor' && <span className="pill role">{u.role}</span>}
            </div>
            <div className="user-id">{u.identifier}</div>
            {u.note && <p className="user-note">{u.note}</p>}
            <div className="user-meta">
              {u.clips} clip{u.clips === 1 ? '' : 's'} · joined {when(u.created_at)}
              {u.last_seen_at ? ` · seen ${when(u.last_seen_at)}` : ''}
            </div>

            <div className="user-acts">
              {u.status === 'pending' ? (
                <>
                  <button className="btn small ghost" disabled={acting === u.id}
                          onClick={() => act(u.id, 'rejected')}>Reject</button>
                  <button className="btn small" disabled={acting === u.id}
                          onClick={() => act(u.id, 'approved', 'reviewer')}>
                    Approve as reviewer
                  </button>
                  <button className="btn small primary" disabled={acting === u.id}
                          onClick={() => act(u.id, 'approved', 'contributor')}>
                    Approve
                  </button>
                </>
              ) : u.status === 'approved' ? (
                u.id === selfId
                  ? <span className="muted small">that's you</span>
                  : <button className="btn small ghost" disabled={acting === u.id}
                            onClick={() => act(u.id, 'suspended')}>Suspend</button>
              ) : (
                <button className="btn small" disabled={acting === u.id}
                        onClick={() => act(u.id, 'approved')}>Re-approve</button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Relative time, because "3 days ago" is the question being asked here —
 *  nobody wants to subtract dates to see how long someone has been waiting. */
function when(seconds: number | null): string {
  if (!seconds) return '—'
  const mins = Math.floor((Date.now() / 1000 - seconds) / 60)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return days < 30 ? `${days}d ago` : new Date(seconds * 1000).toLocaleDateString()
}
