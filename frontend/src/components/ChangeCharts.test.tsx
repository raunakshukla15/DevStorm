import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import type { AnalysisResult as AnalysisResultData } from '../types/api'
import { AnalysisResult } from './AnalysisResult'
import { ChangeCharts } from './ChangeCharts'

const LIVE_RESULT: AnalysisResultData = {
  success: true,
  status: 'analyzed',
  hazard: 'flood',
  hazard_label: 'Flood / standing water change',
  data_source: 'NASA-ISRO NISAR via NASA Earthdata (live granules, windowed streaming)',
  requested_dates: {
    before: '2026-08-10',
    after: 'latest (auto)',
  },
  actual_granule_dates: {
    before: '2026-08-11T12:30:00Z',
    after: '2026-10-18T12:33:47Z',
  },
  date_differences: {
    requested_before: '2026-08-10',
    actual_before: '2026-08-11',
    before_diff_days: 1,
    before_differs: true,
    requested_after: 'latest (auto)',
    actual_after: '2026-10-18',
    after_diff_days: null,
    after_differs: false,
    after_is_latest: true,
    any_differs: true,
    note: 'Before requested 2026-08-10; real pass used 2026-08-11 (+1d due to ~12-day NISAR repeat).',
  },
  same_orbit_pair: true,
  location: { lat: 26.2, lon: 92.9 },
  analysis: {
    mean_backscatter_difference_db: -2.1,
    std_difference_db: 1.4,
    percentage_decrease: 38.0,
    percentage_disturbed: 41.2,
    affected_area_km2: 3.45,
    area_basis: 'outline pixels x product ground spacing',
    valid_pixels: 4800,
    total_pixels: 4800,
  },
  images: {
    before: 'before.png',
    after: 'after.png',
    difference: 'difference.png',
  },
  windows: {
    size: 256,
    before_layer: 'HH',
    after_layer: 'HH',
    before_origin: [0, 0],
    before_shape: [256, 256],
    after_origin: [0, 0],
    after_shape: [256, 256],
    bounds: [
      [26.1, 92.8],
      [26.3, 93.0],
    ],
  },
  comparison: {
    before_mean_db: -9.85,
    before_median_db: -9.7,
    before_std_db: 1.5,
    before_p10_db: -11.9,
    before_p90_db: -7.8,
    after_mean_db: -11.95,
    after_median_db: -11.6,
    after_std_db: 2.1,
    after_p10_db: -14.8,
    after_p90_db: -9.1,
    delta_mean_db: -2.1,
    delta_median_db: -1.9,
    threshold_db: -2.0,
  },
  backscatter_histogram: [
    { bin: '-12.5..-10.0', mid_db: -11.25, before_pct: 42.0, after_pct: 55.0 },
    { bin: '-10.0..-7.5', mid_db: -8.75, before_pct: 58.0, after_pct: 45.0 },
  ],
  delta_histogram: [
    { bin: '-3..-2', mid_db: -2.5, pct: 38.0, direction: 'drop' },
    { bin: '-1..0', mid_db: -0.5, pct: 62.0, direction: 'stable' },
  ],
  condition_breakdown: [
    { key: 'strong_drop', label: 'Strong drop (< -3 dB)', pixels: 1200, pct: 25.0, color: '#22d3ee' },
    { key: 'stable', label: 'Stable (-1.5..+1.5 dB)', pixels: 3600, pct: 75.0, color: '#64748b' },
  ],
  transect: [
    { step: 0, offset_km: 0, before_db: -9.5, after_db: -11.8, delta_db: -2.3 },
    { step: 10, offset_km: 0.2, before_db: -9.9, after_db: -12.1, delta_db: -2.2 },
  ],
  timing: { cmr_search_s: 2.1, stream_s: 19.4, compute_s: 0.9, total_s: 22.4 },
}

describe('ChangeCharts', () => {
  it('renders live NASA Earthdata charts, timing chips, and Δ histogram toggle', () => {
    render(<ChangeCharts result={LIVE_RESULT} />)

    expect(screen.getByTestId('change-charts')).toBeTruthy()
    expect(screen.getByText(/Live NASA Earthdata NISAR/i)).toBeTruthy()
    expect(screen.getByText(/Before vs After Backscatter Comparison \(2026-08-11 → 2026-10-18\)/i)).toBeTruthy()
    expect(screen.getByText(/Total: 22.4s/i)).toBeTruthy()

    expect(screen.getByText(/Surface Change Classification/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Δ dB Bins/i }))
    expect(screen.getByText(/Δ Backscatter Shift Histogram/i)).toBeTruthy()
  })
})

describe('AnalysisResult real-data views', () => {
  it('renders todays condition summary, requested vs real dates, and 3-panel imagery', () => {
    render(
      <MemoryRouter>
        <AnalysisResult result={LIVE_RESULT} jobId="job123" />
      </MemoryRouter>,
    )

    expect(screen.getByTestId('todays-condition-summary')).toBeTruthy()
    expect(screen.getByTestId('date-comparison-panel')).toBeTruthy()
    expect(screen.getByText(/\+1d offset/i)).toBeTruthy()
    expect(screen.getByText(/newest available pass/i)).toBeTruthy()
    expect(screen.getByTestId('side-by-side-images')).toBeTruthy()
    expect(screen.getByText(/1\. Before Pass/i)).toBeTruthy()
    expect(screen.getByText(/2\. After Pass \(Latest\)/i)).toBeTruthy()
    expect(screen.getByText(/3\. Detected Change/i)).toBeTruthy()
  })
})
