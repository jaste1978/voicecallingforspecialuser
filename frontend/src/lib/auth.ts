// Session token handling + authenticated fetch.

export function getToken(): string | null {
  return localStorage.getItem('authToken')
}

export function setAuth(token: string, name: string, role: string) {
  localStorage.setItem('authToken', token)
  localStorage.setItem('authName', name)
  localStorage.setItem('authRole', role)
}

export function authName(): string {
  return localStorage.getItem('authName') || ''
}

export function isAdmin(): boolean {
  return localStorage.getItem('authRole') === 'admin'
}

export function clearAuth() {
  localStorage.removeItem('authToken')
  localStorage.removeItem('authName')
  localStorage.removeItem('authRole')
}

export function wsAuth(url: string): string {
  const t = getToken()
  return t ? `${url}?token=${t}` : url
}

export function audioUrl(path: string): string {
  const t = getToken()
  return t ? `${path}?token=${t}` : path
}

export async function authFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const t = getToken()
  const headers = new Headers(init.headers)
  if (t) headers.set('Authorization', `Bearer ${t}`)
  const resp = await fetch(input, { ...init, headers })
  if (resp.status === 401) {
    clearAuth()
    window.location.href = '/login'
  }
  return resp
}
