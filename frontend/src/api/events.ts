import { apiFetch } from './client'
import type { Granule, LiveEventsResponse } from '../types/api'

export interface NisarEventMatch {
  event_date: string
  location: { lat: number; lon: number }
  short_name?: string | null
  pre_event_granule?: Granule | null
  post_event_granule?: Granule | null
  suggested_before_date: string
  suggested_after_date: string
  has_both_passes: boolean
}

export function fetchLiveEvents(hazard?: string): Promise<LiveEventsResponse> {
  const q = hazard && hazard !== 'all' ? `?hazard=${encodeURIComponent(hazard)}` : ''
  return apiFetch<LiveEventsResponse>(`/events/live${q}`)
}

export function matchNisarForEvent(lat: number, lon: number, eventDate: string): Promise<NisarEventMatch> {
  const q = new URLSearchParams({
    lat: String(lat),
    lon: String(lon),
    event_date: eventDate,
  })
  return apiFetch<NisarEventMatch>(`/events/match-nisar?${q}`)
}
