export type HazardId =
  | 'flood'
  | 'tsunami'
  | 'hurricane'
  | 'volcano'
  | 'earthquake'
  | 'forest_disturbance'
  | 'landslide'
  | 'agriculture'
  | 'deformation'

export interface HazardMeta {
  id: HazardId
  label: string
  color: string
  defaultBand?: string
  ruleBadge?: string
  datasetLabel?: string
  summary?: string
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

export interface DateDifferences {
  requested_before?: string | null
  actual_before?: string | null
  before_diff_days?: number | null
  before_differs?: boolean
  requested_after?: string | null
  actual_after?: string | null
  after_diff_days?: number | null
  after_differs?: boolean
  after_is_latest?: boolean
  any_differs?: boolean
  note?: string | null
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
    confidence_score?: number
    confidence_level?: string
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
  mean_coherence?: number | null
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
  stride?: number
  downsampled?: boolean
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
  date_differences?: DateDifferences | null
  same_orbit_pair?: boolean
  location?: LocationPoint
  bbox?: number[] | null
  short_name?: string | null
  polarization_band?: string
  threshold_db?: number
  threshold_mode?: string
  speckle_filter?: string
  detection_mode?: string
  severity?: 'High' | 'Medium' | 'Low'
  severity_rule?: string
  windows?: WindowsMetadata
  before_granule?: Granule
  after_granule?: Granule
  compatibility_check?: {
    compatible: boolean
    warnings: string[]
  }
  images?: {
    before?: string
    after?: string
    difference?: string
    rgb?: string
  }
  raw_stats?: {
    mean_difference_db: number
    std_difference_db: number
    percentage_decrease: number
  } | null
  auxiliary_masks?: {
    water_mask_requested: boolean
    slope_mask_requested: boolean
    masks_applied: boolean
    status: string
    notes: string[]
  }
  comparison?: ComparisonStats | null
  backscatter_histogram?: BackscatterBin[]
  delta_histogram?: DeltaBin[]
  condition_breakdown?: ConditionClass[]
  transect?: TransectPoint[]
  timing?: AnalysisTiming | null
  analysis?: AnalysisMetrics
  results?: Record<string, GeoJsonCollection>
  processing_note?: string
  caveats_and_limitations?: string[]
  confidence?: {
    score?: number
    level?: string
    formula?: string
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
  confidence_score?: number | null
  severity?: string | null
  outlines: number
  error?: string | null
  created_at: string
}

export interface Job {
  job_id: string
  status: string
  stage: string
  progress: number
  params: Record<string, unknown>
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

export interface ComparisonStats {
  before_mean_db: number
  before_median_db: number
  before_std_db: number
  before_p10_db: number
  before_p90_db: number
  after_mean_db: number
  after_median_db: number
  after_std_db: number
  after_p10_db: number
  after_p90_db: number
  delta_mean_db: number
  delta_median_db: number
  threshold_db: number
}

export interface BackscatterBin {
  bin: string
  mid_db: number
  before_pct: number
  after_pct: number
}

export interface DeltaBin {
  bin: string
  mid_db: number
  pct: number
  direction: 'drop' | 'stable' | 'gain' | string
}

export interface ConditionClass {
  key: string
  label: string
  pixels: number
  pct: number
  color: string
}

export interface TransectPoint {
  step: number
  offset_km: number
  before_db: number
  after_db: number
  delta_db: number
}

export interface AnalysisTiming {
  cmr_search_s: number
  stream_s: number
  compute_s: number
  total_s: number
}

export interface PassSummary {
  id?: string | null
  title?: string | null
  date: string
  acquisition_date?: string | null
  orbit_direction?: string | null
  covers_point?: boolean
}

export interface PointInsights {
  available: boolean
  location: LocationPoint
  short_name?: string | null
  granules_last_90d?: number | null
  granules_last_180d?: number | null
  earliest_acquisition?: string | null
  latest_acquisition?: string | null
  latest_granule?: Granule | null
  recent_acquisitions?: string[]
  available_passes?: PassSummary[]
  query_elapsed_ms?: number | null
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

export interface AoiItem {
  id: number
  name: string
  bbox: number[]
  area_km2: number
  created_at: string
}

export interface LiveEvent {
  id: string
  source: string
  hazard: string
  title: string
  lat: number
  lon: number
  date: string
  magnitude?: number | null
  url?: string | null
  category?: string | null
}

export interface LiveEventsResponse {
  events: LiveEvent[]
  warnings: string[]
}

export interface TimeseriesPoint {
  id?: number
  granule_id?: string | null
  acquisition_date: string
  mean_db: number
  std_db: number
  orbit_direction?: string
  valid_pixels?: number | null
}

export interface TimeseriesJob {
  series_id: string
  lat: number
  lon: number
  band: string
  months: number
  status: string
  total_granules?: number | null
  processed_granules?: number | null
  error?: string | null
  created_at: string
  points: TimeseriesPoint[]
}

export interface WatchlistItem {
  id: number
  name: string
  lat: number
  lon: number
  hazard: string
  severity_threshold: string
  email?: string | null
  last_checked?: string | null
  last_granule_date?: string | null
  created_at: string
}

export interface AlertItem {
  id: number
  watchlist_id?: number | null
  job_id?: string | null
  hazard: string
  location_name: string
  severity: string
  message: string
  granule_id?: string | null
  acknowledged: boolean
  created_at: string
}

export interface DiscoveredCollection {
  short_name: string
  version: string
  title: string
  concept_id?: string | null
  family: string
  processing_level?: string | null
  abstract: string
}
