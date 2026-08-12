type Envelope<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } }

let csrfToken = ''
let playerSessionRef = ''
const basePath = import.meta.env.BASE_URL === '/' ? '' : import.meta.env.BASE_URL.replace(/\/$/, '')

export const agentSessionExpiredEvent = 'chattool:agent-session-expired'

export function notifyAgentSessionExpired(message = '登录已失效，请重新登录') {
	window.dispatchEvent(new CustomEvent(agentSessionExpiredEvent, { detail: { message } }))
}

export function appURL(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`
  return `${basePath}${normalized}`
}

export function setCSRF(value: string) {
	csrfToken = value
}

export function setPlayerSessionRef(value: string) {
	playerSessionRef = /^[a-f0-9]{32}$/.test(value) ? value : ''
}

export function playerSessionURL(path: string): string {
	const url = appURL(path)
	if (!playerSessionRef) return url
	return `${url}${url.includes('?') ? '&' : '?'}sessionRef=${encodeURIComponent(playerSessionRef)}`
}

export class ApiError extends Error {
  code: string
  status: number

  constructor(code: string, message: string, status: number) {
    super(message)
    this.code = code
    this.status = status
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json')
	if (csrfToken && init.method && init.method !== 'GET') headers.set('X-CSRF-Token', csrfToken)
  if (playerSessionRef && path.startsWith('/api/player/')) headers.set('X-Player-Session-Ref', playerSessionRef)
  const response = await fetch(appURL(path), { ...init, headers, credentials: 'same-origin' })
	if (response.status === 401 && path.startsWith('/api/agent/') && path !== '/api/agent/auth/login') {
		notifyAgentSessionExpired()
	}
  if (response.status === 204) return undefined as T
  let result: Envelope<T>
  try {
    result = await response.json() as Envelope<T>
  } catch {
    throw new ApiError('INVALID_RESPONSE', '服务器返回了无法识别的内容', response.status)
  }
  if (!response.ok || !result.ok) {
    const error = !result.ok ? result.error : { code: 'REQUEST_FAILED', message: '请求失败' }
    throw new ApiError(error.code, error.message, response.status)
  }
  return result.data
}

export function jsonBody(value: unknown): string {
  return JSON.stringify(value)
}

export function mediaURL(id: string): string {
	return playerSessionURL(`/api/media/${encodeURIComponent(id)}`)
}
