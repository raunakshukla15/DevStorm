import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PREFS, DEFAULT_PROFILE, usePrefsStore } from '../store/usePrefsStore'
import type { AnalysisResult } from '../types/api'
import ChangeAnalysis from './ChangeAnalysis'

const mockFetchPointInsights = vi.fn().mockResolvedValue({
  available: false,
  lat: 26.2,
  lon: 92.9,
  granules_last_90d: 0,
})

const mockStartHazardJob = vi.fn().mockResolvedValue({
  job_id: 'eq999',
  status: 'running',
  status_url: '/api/v1/analysis/jobs/eq999',
  hazard: 'earthquake',
  message: 'started',
})

vi.mock('../api/analysis', () => ({
  fetchPointInsights: (...args: unknown[]) => mockFetchPointInsights(...args),
  startHazardJob: (...args: unknown[]) => mockStartHazardJob(...args),
  fetchJob: vi.fn().mockResolvedValue({
    job_id: 'eq999',
    status: 'running',
    stage: 'searching',
    progress: 15,
    created_at: '2026-11-11T12:00:00Z',
  }),
  jobExportUrl: vi.fn(() => '/export'),
  jobImageUrl: vi.fn((_id: string, img: string) => `/${img}`),
}))

vi.mock('../components/ResultMapOverlay', () => ({
  ResultMapOverlay: () => <div data-testid="mock-map-overlay" />,
}))

function renderChangeAnalysis() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/change']}>
        <ChangeAnalysis />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const PRIOR_FLOOD_RESULT: AnalysisResult = {
  success: true,
  status: 'analyzed',
  hazard: 'flood',
  hazard_label: 'Flood / wetland change',
  data_source: 'NASA-ISRO NISAR via NASA Earthdata',
  requested_dates: { before: '2026-08-10', after: 'latest (auto)' },
  actual_granule_dates: { before: '2026-08-11T00:00:00Z', after: '2026-10-18T00:00:00Z' },
  location: { lat: 26.2, lon: 92.9 },
  analysis: {
    mean_backscatter_difference_db: -2.1,
    percentage_decrease: 18.5,
    percentage_disturbed: 20.1,
    affected_area_km2: 2.3,
  },
}

describe('ChangeAnalysis hazard button interactions', () => {
  beforeEach(() => {
    mockFetchPointInsights.mockClear()
    mockStartHazardJob.mockClear()
    usePrefsStore.setState({
      prefs: { ...DEFAULT_PREFS },
      profile: { ...DEFAULT_PROFILE },
      viewedIds: [],
      lastResult: null,
      activeJobId: null,
      activeJobStartedAt: null,
    })
  })

  it('updates active hazard pill, mode summary, button label, and CMR dataset when clicked', async () => {
    renderChangeAnalysis()

    const floodBtn = screen.getByRole('button', { name: 'Flood' })
    const eqBtn = screen.getByRole('button', { name: 'Earthquake' })
    expect(floodBtn).toHaveAttribute('aria-pressed', 'true')
    expect(eqBtn).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByTestId('selected-hazard-summary')).toHaveTextContent('Flood mode')
    expect(screen.getByRole('button', { name: 'Compare (Flood)' })).toBeInTheDocument()

    fireEvent.click(eqBtn)

    expect(eqBtn).toHaveAttribute('aria-pressed', 'true')
    expect(floodBtn).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByTestId('selected-hazard-summary')).toHaveTextContent('Earthquake mode')
    expect(screen.getByTestId('selected-hazard-summary')).toHaveTextContent('|Δσ⁰| > 2.0 dB magnitude')
    expect(screen.getByRole('button', { name: 'Compare (Earthquake)' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'InSAR Deform.' }))
    await waitFor(() => {
      expect(mockFetchPointInsights).toHaveBeenCalledWith(26.2, 92.9, 'nisar_l2_gunw')
    })
  })

  it('surfaces mismatch notice and 1-click Run Earthquake now when a prior Flood result is displayed', async () => {
    usePrefsStore.setState({ lastResult: PRIOR_FLOOD_RESULT })
    renderChangeAnalysis()

    fireEvent.click(screen.getByRole('button', { name: 'Earthquake' }))
    const quickRunBtn = screen.getByRole('button', { name: 'Run Earthquake now' })
    expect(quickRunBtn).toBeInTheDocument()

    fireEvent.click(quickRunBtn)

    await waitFor(() => {
      expect(mockStartHazardJob).toHaveBeenCalledTimes(1)
    })
    expect(mockStartHazardJob.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        hazard: 'earthquake',
        lat: 26.2,
        lon: 92.9,
        beforeDate: '2026-08-10',
        afterDate: 'latest',
        datasetId: 'nisar_l2_gcov',
      }),
    )
  })
})
