import { apiFetch } from './client'
import type { AlertItem, WatchlistItem } from '../types/api'

export function fetchWatchlist(): Promise<WatchlistItem[]> {
  return apiFetch<WatchlistItem[]>('/watchlist')
}

export function createWatchlist(payload: {
  name: string
  lat: number
  lon: number
  hazard: string
  severity_threshold: string
  email?: string
}): Promise<WatchlistItem> {
  return apiFetch<WatchlistItem>('/watchlist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export function deleteWatchlist(id: number): Promise<{ deleted: boolean }> {
  return apiFetch<{ deleted: boolean }>(`/watchlist/${id}`, { method: 'DELETE' })
}

export function triggerWatchlistCheck(): Promise<{
  checked: number
  alerts_created: number
  errors: string[]
}> {
  return apiFetch('/watchlist/check', { method: 'POST' })
}

export function fetchAlerts(): Promise<AlertItem[]> {
  return apiFetch<AlertItem[]>('/alerts')
}

export function acknowledgeAlert(id: number): Promise<{ acknowledged: boolean }> {
  return apiFetch<{ acknowledged: boolean }>(`/alerts/${id}/acknowledge`, { method: 'POST' })
}

export function dismissAlert(id: number): Promise<{ deleted: boolean }> {
  return apiFetch<{ deleted: boolean }>(`/alerts/${id}`, { method: 'DELETE' })
}
