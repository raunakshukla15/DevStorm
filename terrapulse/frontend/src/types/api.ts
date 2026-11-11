export type HazardId = 'flood' | 'tsunami' | 'hurricane' | 'volcano' | 'earthquake'

export interface HazardMeta {
  id: HazardId
  label: string
  color: string
}

export interface Region {
  id: string
  name: string
  detail: string
  lat: number
  lon: number
}

export interface DatePair {
  before?: string | null
  after?: string | null
}

export interface LocationPoint {
  lat: number
  lon: number
}

export interface Granule {
  id?: string | null
  title?: string | null
  short_name?: string | null
  acquisition_date?: string | null
  orbit_direction?: string | null
  bounding_box?: number[] | null
  https_url?: string | null
  s3_url?: string | null
  browse_url?: string | null
}

export interface GeoJsonFeature {
  type: 'Feature'
  properties: {
    threshold?: number
    pixel_count?: number
    area_km2?: number | null
    mean_difference_db?: number
    min_difference_db?: number
    flood_indicator?: boolean
  }
  geometry: {
    type: string
    coordinates: number[] | number[][] | number[][][] | number[][][][]
  }
}

export interface GeoJsonCollection {
  type: 'FeatureCollection'
  features: GeoJsonFeature[]
  metadata?: Record<string, string | number | boolean | null>
}

export interface AnalysisMetrics {
  mean_backscatter_difference_db?: number | null
  std_difference_db?: number | null
  percentage_decrease?: number | null
  percentage_disturbed?: number | null
  affected_area_km2?: number | null
  area_basis?: string
  valid_pixels?: number | null
  total_pixels?: number | null
}

export interface WindowsMetadata {
  size: number
  requested_window?: number
  before_layer: string
  after_layer: string
  before_origin: number[]
  before_shape: number[]
  after_origin: number[]
  after_shape: number[]
  crs?: string
  epsg?: number | null
  bounds?: [[number, number], [number, number]] | null
  note?: string
}

export interface AnalysisResult {
  success: boolean
  status: string
  method?: string
  hazard?: string
  hazard_label?: string
  interpretation?: string
  data_source?: string
  requested_dates?: DatePair
  auto_dates?: boolean
  actual_granule_dates?: DatePair
  same_orbit_pair?: boolean
  location?: LocationPoint
  short_name?: string | null
  polarization_band?: string
  threshold_db?: number
  detection_mode?: string
  windows?: WindowsMetadata
  before_granule?: Granule
  after_granule?: Granule
  compatibility_check?: {
    compatible: boolean
    warnings: string[]
  }
  analysis?: AnalysisMetrics
  results?: Record<string, GeoJsonCollection>
  processing_note?: string
  caveats_and_limitations?: string[]
  confidence?: {
    based_on: string
    quality: string
    requires_validation: string
  }
  produced_at?: string
}

export interface JobSummary {
  job_id: string
  status: string
  stage?: string | null
  progress: number
  hazard: string
  location: {
    lat: number | null
    lon: number | null
  }
  requested_dates: DatePair
  actual_granule_dates?: DatePair | null
  auto_dates: boolean
  mean_db?: number | null
  percentage_decrease?: number | null
  percentage_disturbed?: number | null
  affected_area_km2?: number | null
  outlines: number
  error?: string | null
  created_at: string
}

export interface Job {
  job_id: string
  status: string
  stage: string
  progress: number
  params: Record<string, string | number | null | undefined>
  created_at: string
  result?: AnalysisResult | null
  error?: string | null
}

export interface JobStartResponse {
  job_id: string
  status: string
  status_url: string
  hazard?: string | null
  message: string
}

export interface PointInsights {
  available: boolean
  location: LocationPoint
  short_name?: string | null
  granules_last_90d?: number | null
  latest_acquisition?: string | null
  latest_granule?: Granule | null
  recent_acquisitions?: string[]
  supported_hazards?: string[]
  short_names_searched?: string[]
  note?: string
}

export interface Observation {
  id?: string | null
  title?: string | null
  short_name?: string | null
  dataset_id: string
  acquisition_date?: string | null
  orbit_direction?: string
  location: LocationPoint
  bounding_box?: number[] | null
  https_url?: string | null
  s3_url?: string | null
}

export interface GeocodeResult {
  lat: string
  lon: string
  display_name: string
  type?: string | null
  importance?: number | null
}

export interface AuthStatus {
  connected: boolean
  timestamp: string
  note: string
}

export interface HealthStatus {
  status: string
  service: string
}
