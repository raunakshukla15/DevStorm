import { apiFetch } from './client'
import type { TimeseriesJob } from '../types/api'

export function startTimeseries(params: {
  lat: number
  lon: number
  band: string
  months: number
}): Promise<TimeseriesJob> {
  return apiFetch<TimeseriesJob>('/timeseries', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
}

export function fetchTimeseries(seriesId: string): Promise<TimeseriesJob> {
  return apiFetch<TimeseriesJob>(`/timeseries/${encodeURIComponent(seriesId)}`)
}
