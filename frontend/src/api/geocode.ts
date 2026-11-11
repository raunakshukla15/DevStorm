import { apiFetch } from './client'
import type { GeocodeResult } from '../types/api'

export function geocodePlace(query: string, limit = 1): Promise<GeocodeResult[]> {
  const q = new URLSearchParams({ q: query.trim(), limit: String(limit) })
  return apiFetch<GeocodeResult[]>(`/geocode?${q}`)
}
