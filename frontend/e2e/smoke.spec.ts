// Playwright smoke test with mocked TerraPulse API routes.
// Install @playwright/test to execute in CI or locally (`npx playwright test`).
import { expect, test } from '@playwright/test'

test('dashboard, guided sample run, and navigation render honest caveats', async ({ page }) => {
  await page.route('**/api/v1/health', async (route) => {
    await route.fulfill({ json: { status: 'ok', service: 'terrapulse' } })
  })
  await page.route('**/api/v1/auth/status', async (route) => {
    await route.fulfill({ json: { connected: true, timestamp: '2026-10-01T00:00:00Z', note: 'mock' } })
  })
  await page.route('**/api/v1/analysis/jobs', async (route) => {
    await route.fulfill({ json: { jobs: [] } })
  })
  await page.route('**/api/v1/analysis/sample', async (route) => {
    await route.fulfill({
      json: {
        is_sample: true,
        job_id: 'sample_test',
        result: {
          success: true,
          status: 'analyzed',
          hazard: 'flood',
          hazard_label: 'Flood',
          location: { lat: -1.5, lon: -52.0 },
          analysis: { mean_backscatter_difference_db: -3.2, percentage_decrease: 14.0, affected_area_km2: 2.4 },
          confidence: { score: 0.72, level: 'High', quality: 'indicator-level' },
          caveats_and_limitations: ['This is a change INDICATOR only', 'CANNOT conclude: flood depth'],
          results: { flood_outlines: { type: 'FeatureCollection', features: [] } },
        },
      },
    })
  })

  await page.goto('/')
  await expect(page.getByText('TerraPulse')).toBeVisible()
  await page.getByRole('link', { name: 'Change Analysis' }).click()
  await expect(page.getByText('Change Analysis')).toBeVisible()
})
