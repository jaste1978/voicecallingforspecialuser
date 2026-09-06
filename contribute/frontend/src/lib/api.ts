// Talking to the contribution service.

import type { SignFrame } from '@sign/poseFormat'

export interface Phrase {
  id: string
  hi: string
  gu: string
  en: string
  gloss: string
  kind: string
  tier: number
  face: string
  note: string
  target_count: number
  have: number
  mine: number
}

export interface ConsentCheck {
  id: string
  required: boolean
  hi: string
  en: string
}

export interface ConsentDoc {
  version: string
  hash: string
  title: { hi: string; en: string }
  points: { hi: string; en: string }[]
  checks: ConsentCheck[]
}

export interface Coverage {
  body: number
  face: number
  handL: number
  handR: number
}

export interface Progress {
  total: number
  today: number
  phrases: number
}

export type Role = 'contributor' | 'reviewer' | 'admin'
export type Status = 'pending' | 'approved' | 'rejected' | 'suspended'

export interface User {
  id: string
  name: string
  identifier: string
  role: Role
  status: Status
  credit_optin: boolean
}

export interface AdminUser extends Omit<User, 'credit_optin'> {
  note: string
  clips: number
  created_at: number
  approved_at: number | null
  last_seen_at: number | null
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    // The session is an httpOnly cookie, so it has to ride along on every
    // call — and it must never be readable by script, which is the whole
    // reason it is not in localStorage.
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  if (!res.ok) {
    let detail = ''
    try {
      detail = ((await res.json()) as { error?: string }).error ?? ''
    } catch { /* body was not json; the status is enough */ }
    throw new Error(detail || `request failed (${res.status})`)
  }
  return res.json() as Promise<T>
}

export const getConsentDoc = () => json<ConsentDoc>('/api/consent-text')

export const getPhrases = (limit = 25) =>
  json<{ phrases: Phrase[] }>(`/api/phrases?limit=${limit}`).then((r) => r.phrases)

export const getProgress = () => json<Progress>('/api/me')

// ---- accounts --------------------------------------------------------------

export interface Auth {
  user: User | null
  access_mode: 'approval' | 'open'
}

export const getMe = () => json<Auth>('/api/auth/me')

export interface ServerConfig {
  access_mode: 'approval' | 'open'
  turnstile_sitekey: string
  consent_version: string
  r2: boolean
}

export const getConfig = () => json<ServerConfig>('/api/health')

export const register = (body: {
  name: string; identifier: string; password: string; note: string
}) => json<Auth>('/api/auth/register', { method: 'POST', body: JSON.stringify(body) })

export const login = (body: { identifier: string; password: string }) =>
  json<Auth>('/api/auth/login', { method: 'POST', body: JSON.stringify(body) })

export const logout = () => json<{ ok: boolean }>('/api/auth/logout', { method: 'POST' })

export const getCurrentConsent = () =>
  json<{ consent_id: string | null; version: string }>('/api/consent/current')

// ---- admin -----------------------------------------------------------------

export const adminUsers = (status = '') =>
  json<{ users: AdminUser[] }>(
    `/api/admin/users${status ? `?status=${encodeURIComponent(status)}` : ''}`,
  ).then((r) => r.users)

export const setUserStatus = (id: string, status: Status, role?: Role) =>
  json<{ ok: boolean }>(`/api/admin/users/${id}/status`, {
    method: 'POST', body: JSON.stringify({ status, ...(role ? { role } : {}) }),
  })

export const getStats = () =>
  json<{ clips: number; people: number; phrases_covered: number; phrases_total: number }>(
    '/api/stats',
  )

export function postConsent(body: {
  contact: string
  lang: string
  checks: Record<string, boolean>
}) {
  return json<{ contributor_id: string; consent_id: string; version: string }>(
    '/api/consent', { method: 'POST', body: JSON.stringify(body) },
  )
}

export interface SubmitBody {
  phrase_id: string
  consent_id: string
  frames: SignFrame[]
  duration_ms: number
  fps: number
  coverage: Coverage
  video_mime: string
  turnstile?: string
}

export interface SubmitResult {
  id: string
  upload_url: string | null
  video_key: string
  video_status: string
  keypoints_bytes: number
}

export const postContribution = (body: SubmitBody) =>
  json<SubmitResult>('/api/contributions', { method: 'POST', body: JSON.stringify(body) })

export const reportVideo = (id: string, ok: boolean) =>
  json<{ video_status: string }>(`/api/contributions/${id}/video`, {
    method: 'POST', body: JSON.stringify({ ok }),
  })

/**
 * Send the video to R2 with the URL the API presigned.
 *
 * The Content-Type has to match the one the URL was signed for exactly, or
 * R2 rejects the PUT — which is why the mime is normalised (codecs stripped)
 * before it is ever sent to the API.
 */
export async function putVideo(url: string, blob: Blob, mime: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: 'PUT',
      body: blob,
      headers: { 'Content-Type': mime },
    })
    return res.ok
  } catch {
    return false
  }
}
