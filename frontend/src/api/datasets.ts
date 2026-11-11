import { apiFetch } from './client'
import type { DiscoveredCollection } from '../types/api'

export interface DatasetItem {
  id: string
  short_name: string
  fallback_short_name?: string | null
  name: string
  provider: string
  description: string
  product_type: string
  spatial_resolution: string
  polarizations: string[]
}

export function fetchDatasets(): Promise<DatasetItem[]> {
  return apiFetch<DatasetItem[]>('/datasets')
}

export function discoverNisarCollections(): Promise<DiscoveredCollection[]> {
  return apiFetch<DiscoveredCollection[]>('/datasets/discover')
}
