import { apiFetch } from './client'
import type { AoiItem } from '../types/api'

export function fetchAois(): Promise<AoiItem[]> {
  return apiFetch<AoiItem[]>('/aois')
}

export function createAoi(name: string, bbox: number[]): Promise<AoiItem> {
  return apiFetch<AoiItem>('/aois', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, bbox }),
  })
}

export function deleteAoi(id: number): Promise<{ deleted: boolean }> {
  return apiFetch<{ deleted: boolean }>(`/aois/${id}`, { method: 'DELETE' })
}
