import { API_BASE, apiFetch } from './client'
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
  bbox?: number[] | null
  speckleFilter?: string
  thresholdMode?: string
  waterMask?: boolean
  slopeMask?: boolean
}

export function fetchJobs(limit = 50): Promise<JobSummary[]> {
  return apiFetch<JobSummary[]>(`/analysis/jobs?limit=${limit}`)
}

export function fetchJob(jobId: string): Promise<Job> {
  return apiFetch<Job>(`/analysis/jobs/${encodeURIComponent(jobId)}`)
}

export function jobExportUrl(jobId: string, format: 'geojson' | 'tif' | 'csv' | 'png' | 'pdf'): string {
  return `${API_BASE}/analysis/jobs/${encodeURIComponent(jobId)}/export?format=${format}`
}

export function jobImageUrl(jobId: string, imageName: string): string {
  if (imageName.startsWith('http')) return imageName
  if (imageName.startsWith('/api/v1')) {
    return `${API_BASE.replace(/\/api\/v1$/, '')}${imageName}`
  }
  return `${API_BASE}/analysis/jobs/${encodeURIComponent(jobId)}/image/${imageName}`
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
    band: params.band ?? 'HH',
    window: String(params.window ?? 256),
    speckle_filter: params.speckleFilter ?? 'none',
    threshold_mode: params.thresholdMode ?? 'fixed',
    water_mask: String(Boolean(params.waterMask)),
    slope_mask: String(Boolean(params.slopeMask)),
  })
  if (params.datasetId) q.set('dataset_id', params.datasetId)
  if (params.beforeDate) {
    q.set('before_date', params.beforeDate)
    q.set('after_date', params.afterDate || 'latest')
  }
  if (params.bbox && params.bbox.length === 4) {
    q.set('bbox', params.bbox.join(','))
  }
  return apiFetch<JobStartResponse>(`/analysis/hazard?${q}`, { method: 'POST' })
}
