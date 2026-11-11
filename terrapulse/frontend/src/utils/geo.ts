import type { HazardMeta, Region } from '../types/api'

export const REGIONS: Region[] = [
  { id: 'amazon', name: 'Amazon Basin', detail: 'Brazil', lat: -1.5, lon: -52.0 },
  { id: 'mekong', name: 'Mekong Delta', detail: 'Vietnam', lat: 10.0, lon: 105.0 },
  { id: 'sahel', name: 'Sahel Region', detail: 'Niger · Nigeria · Chad', lat: 13.5, lon: 2.1 },
  { id: 'andean', name: 'Andean Region', detail: 'Peru · Bolivia · Argentina', lat: -13.0, lon: -72.0 },
]

export const HAZARDS: HazardMeta[] = [
  { id: 'flood', label: 'Flood', color: '#38bdf8' },
  { id: 'tsunami', label: 'Tsunami', color: '#22d3ee' },
  { id: 'hurricane', label: 'Hurricane', color: '#a78bfa' },
  { id: 'volcano', label: 'Volcano', color: '#fb923c' },
  { id: 'earthquake', label: 'Earthquake', color: '#f87171' },
]

export function hazardColor(id: string): string {
  return HAZARDS.find((h) => h.id === id)?.color ?? '#94a3b8'
}

export function hazardLabel(id: string): string {
  return HAZARDS.find((h) => h.id === id)?.label ?? id
}

export function regionName(lat: number | null | undefined, lon: number | null | undefined): string {
  if (typeof lat !== 'number' || typeof lon !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    return 'Unknown'
  }
  let best: Region | null = null
  let bd = 1e9
  for (const r of REGIONS) {
    const d = Math.hypot(r.lat - lat, r.lon - lon)
    if (d < bd) {
      bd = d
      best = r
    }
  }
  return best && bd < 4 ? best.name : `${lat.toFixed(2)}, ${lon.toFixed(2)}`
}
