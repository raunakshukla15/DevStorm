import type { HazardMeta, Region } from '../types/api'

export const REGIONS: Region[] = [
  { id: 'amazon', name: 'Amazon Basin', detail: 'Brazil', lat: -1.5, lon: -52.0 },
  { id: 'mekong', name: 'Mekong Delta', detail: 'Vietnam', lat: 10.0, lon: 105.0 },
  { id: 'sahel', name: 'Sahel Region', detail: 'Niger · Nigeria · Chad', lat: 13.5, lon: 2.1 },
  { id: 'andean', name: 'Andean Region', detail: 'Peru · Bolivia · Argentina', lat: -13.0, lon: -72.0 },
]

// Okabe-Ito inspired colorblind-safe palette
export const HAZARDS: HazardMeta[] = [
  {
    id: 'flood',
    label: 'Flood',
    color: '#0072B2',
    defaultBand: 'HH',
    ruleBadge: 'Δσ⁰ < −2.0 dB drop',
    datasetLabel: 'NISAR L2 GCOV',
    summary: 'Standing water acts as a smooth mirror: L-band backscatter drops sharply (>2 dB darker).',
  },
  {
    id: 'tsunami',
    label: 'Tsunami',
    color: '#56B4E9',
    defaultBand: 'HH',
    ruleBadge: 'Δσ⁰ < −2.0 dB coastal drop',
    datasetLabel: 'NISAR L2 GCOV',
    summary: 'Flags shoreline inundation and wet debris zones where coastal L-band backscatter drops.',
  },
  {
    id: 'hurricane',
    label: 'Hurricane',
    color: '#CC79A7',
    defaultBand: 'HH',
    ruleBadge: 'Flood drop + |Δσ⁰| > 2.0 dB',
    datasetLabel: 'NISAR L2 GCOV',
    summary: 'Captures both rainfall flooding (>2 dB drop) and wind-stripped canopy/debris roughness shifts.',
  },
  {
    id: 'volcano',
    label: 'Volcano',
    color: '#D55E00',
    defaultBand: 'HH',
    ruleBadge: '|Δσ⁰| > 2.0 dB magnitude',
    datasetLabel: 'NISAR L2 GCOV',
    summary: 'Fresh lava flows, ash blankets, and lahars shift ground roughness in either direction (>2 dB).',
  },
  {
    id: 'earthquake',
    label: 'Earthquake',
    color: '#E69F00',
    defaultBand: 'HH',
    ruleBadge: '|Δσ⁰| > 2.0 dB magnitude',
    datasetLabel: 'NISAR L2 GCOV',
    summary: 'Marks shaking-induced disturbance (landslides, rockfalls, liquefaction). For cm slip, pick InSAR Deform.',
  },
  {
    id: 'forest_disturbance',
    label: 'Forest Loss',
    color: '#009E73',
    defaultBand: 'HV',
    ruleBadge: 'HV Δσ⁰ < −2.0 dB drop',
    datasetLabel: 'NISAR L2 GCOV',
    summary: 'Cross-pol HV tracks branch/canopy volume scattering: clearing or blowdown causes a strong drop.',
  },
  {
    id: 'landslide',
    label: 'Landslide',
    color: '#A6761D',
    defaultBand: 'HV',
    ruleBadge: 'HV |Δσ⁰| > 2.0 dB magnitude',
    datasetLabel: 'NISAR L2 GCOV',
    summary: 'Slope failures strip vegetation and expose bare soil/rock, creating >2 dB backscatter shifts.',
  },
  {
    id: 'agriculture',
    label: 'Agriculture',
    color: '#F0E442',
    defaultBand: 'HH/HV',
    ruleBadge: 'HH/HV |Δσ⁰| > 2.0 dB',
    datasetLabel: 'NISAR L2 GCOV',
    summary: 'Polarization ratio shifts track harvesting, tillage, flooding, and crop canopy emergence.',
  },
  {
    id: 'deformation',
    label: 'InSAR Deform.',
    color: '#38BDF8',
    defaultBand: 'HH',
    ruleBadge: 'LOS phase ≥ 2.5 cm',
    datasetLabel: 'NISAR L2 GUNW InSAR',
    summary: 'Streams unwrapped interferometric phase (cm line-of-sight ground displacement) and coherence.',
  },
]

export function hazardMeta(id: string): HazardMeta | undefined {
  return HAZARDS.find((h) => h.id === id)
}

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
