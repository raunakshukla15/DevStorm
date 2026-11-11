export const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:8000/api/v1'

export class ApiError extends Error {
  status: number

  constructor(message: string, status = 0) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const url = path.startsWith('http') ? path : `${API_BASE}${path}`
  const res = await fetch(url, init)
  const contentType = res.headers.get('content-type') ?? ''
  const payload = contentType.includes('application/json') ? await res.json() : null
  if (!res.ok) {
    const detail =
      payload && typeof payload === 'object' && 'detail' in payload && typeof payload.detail === 'string'
        ? payload.detail
        : `Request failed with status ${res.status}`
    throw new ApiError(detail, res.status)
  }
  return payload as T
}
