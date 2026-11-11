import { apiFetch } from './client'
import type { Observation } from '../types/api'

export function searchObservations(params: {
  datasetId?: string
  lat: number
  lon: number
  startDate?: string
  endDate?: string
}): Promise<Observation[]> {
  const q = new URLSearchParams({
    dataset_id: params.datasetId ?? 'nisar_l2_gcov',
    lat: String(params.lat),
    lon: String(params.lon),
  })
  if (params.startDate) q.set('start_date', params.startDate)
  if (params.endDate) q.set('end_date', params.endDate)
  return apiFetch<Observation[]>(`/observations?${q}`)
}
