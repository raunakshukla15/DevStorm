import type { HazardMeta, Region } from '../types/api'

export const REGIONS: Region[] = [
  { id: 'amazon', name: 'Amazon Basin', detail: 'Brazil', lat: -1.5, lon: -52.0 },
  { id: 'mekong', name: 'Mekong Delta', detail: 'Vietnam', lat: 10.0, lon: 105.0 },
  { id: 'sahel', name: 'Sahel Region', detail: 'Niger · Nigeria · Chad', lat: 13.5, lon: 2.1 },
  { id: 'andean', name: 'Andean Region', detail: 'Peru · Bolivia · Argentina', lat: -13.0, lon: -72.0 },
]

// Okabe-Ito inspired colorblind-safe palette
export const HAZARDS: HazardMeta[] = [
  { id: 'flood', label: 'Flood', color: '#0072B2', defaultBand: 'HH' },
  { id: 'tsunami', label: 'Tsunami', color: '#56B4E9', defaultBand: 'HH' },
  { id: 'hurricane', label: 'Hurricane', color: '#CC79A7', defaultBand: 'HH' },
  { id: 'volcano', label: 'Volcano', color: '#D55E00', defaultBand: 'HH' },
  { id: 'earthquake', label: 'Earthquake', color: '#E69F00', defaultBand: 'HH' },
  { id: 'forest_disturbance', label: 'Forest Loss', color: '#009E73', defaultBand: 'HV' },
  { id: 'landslide', label: 'Landslide', color: '#A6761D', defaultBand: 'HV' },
  { id: 'agriculture', label: 'Agriculture', color: '#F0E442', defaultBand: 'HH/HV' },
  { id: 'deformation', label: 'InSAR Deform.', color: '#38BDF8', defaultBand: 'HH' },
]

export function hazardColor(id: string): string {
  return HAZARDS.find((h) => h.id === id)?.color ?? '#94a3b8'
}

export function hazardLabel(id: string): string {
  return HAZARDS.find((h) => h.id === id)?.label ?? id
}

export function approxBboxAreaKm2(bbox: [number, number, number, number]): number {
  const [w, s, e, n] = bbox
  const midLatRad = (((s + n) / 2) * Math.PI) / 180
  const widthKm = Math.abs(e - w) * 111.32 * Math.cos(midLatRad)
  const heightKm = Math.abs(n - s) * 110.57
  return Math.round(widthKm * heightKm * 100) / 100
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
