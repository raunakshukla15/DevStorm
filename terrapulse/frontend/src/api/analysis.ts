import { apiFetch } from './client'
import type { Job, JobStartResponse, JobSummary, PointInsights } from '../types/api'

export interface StartHazardParams {
  hazard: string
  lat: number
  lon: number
  beforeDate?: string
  afterDate?: string
  datasetId?: string
  band?: string
  window?: number
}

export function fetchJobs(limit = 50): Promise<JobSummary[]> {
  return apiFetch<JobSummary[]>(`/analysis/jobs?limit=${limit}`)
}

export function fetchJob(jobId: string): Promise<Job> {
  return apiFetch<Job>(`/analysis/jobs/${encodeURIComponent(jobId)}`)
}

export function fetchPointInsights(lat: number, lon: number, datasetId = 'nisar_l2_gcov'): Promise<PointInsights> {
  const q = new URLSearchParams({
    lat: String(lat),
    lon: String(lon),
    dataset_id: datasetId,
  })
  return apiFetch<PointInsights>(`/analysis/point-insights?${q}`)
}

export function startHazardJob(params: StartHazardParams): Promise<JobStartResponse> {
  const q = new URLSearchParams({
    hazard: params.hazard,
    lat: String(params.lat),
    lon: String(params.lon),
    dataset_id: params.datasetId ?? 'nisar_l2_gcov',
    band: params.band ?? 'HH',
    window: String(params.window ?? 256),
  })
  if (params.beforeDate && params.afterDate) {
    q.set('before_date', params.beforeDate)
    q.set('after_date', params.afterDate)
  }
  return apiFetch<JobStartResponse>(`/analysis/hazard?${q}`, { method: 'POST' })
}
