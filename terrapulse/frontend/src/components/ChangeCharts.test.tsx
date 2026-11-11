import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { AnalysisResult } from '../types/api'
import { ChangeCharts } from './ChangeCharts'

const LIVE_RESULT: AnalysisResult = {
  success: true,
  is_sample: false,
  status: 'analyzed',
  actual_granule_dates: {
    before: '2026-08-10T12:30:00Z',
    after: '2026-10-18T12:33:47Z',
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
    expect(screen.getByText(/Before vs After Backscatter Comparison \(2026-08-10 → 2026-10-18\)/i)).toBeTruthy()
    expect(screen.getByText(/Total: 22.4s/i)).toBeTruthy()

    expect(screen.getByText(/Surface Change Classification/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Δ dB Bins/i }))
    expect(screen.getByText(/Δ Backscatter Shift Histogram/i)).toBeTruthy()
  })

  it('labels sample results explicitly', () => {
    render(<ChangeCharts result={{ ...LIVE_RESULT, is_sample: true }} />)
    expect(screen.getByText(/Sample demonstration/i)).toBeTruthy()
  })
})
