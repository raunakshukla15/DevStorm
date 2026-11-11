import { describe, expect, it } from 'vitest'
import { metricOf, severityOf } from './severity'

describe('severity helpers', () => {
  it('picks disturbed metric for magnitude hazards and decrease for inundation hazards', () => {
    expect(
      metricOf({ hazard: 'earthquake', percentage_disturbed: 14.2, percentage_decrease: 4.1 }),
    ).toBe(14.2)
    expect(
      metricOf({ hazard: 'flood', percentage_disturbed: 14.2, percentage_decrease: 6.5 }),
    ).toBe(6.5)
  })

  it('prefers backend-computed severity and evaluates area-confidence fallback truthfully', () => {
    expect(
      severityOf({
        hazard: 'flood',
        severity: 'Medium',
        affected_area_km2: 20,
        confidence_score: 0.9,
      }),
    ).toBe('Medium')

    expect(
      severityOf({
        hazard: 'flood',
        affected_area_km2: 3.2,
        confidence_score: 0.72,
      }),
    ).toBe('High')

    expect(
      severityOf({
        hazard: 'flood',
        affected_area_km2: 0.8,
        confidence_score: 0.55,
      }),
    ).toBe('Medium')

    expect(
      severityOf({
        hazard: 'flood',
        affected_area_km2: 0.1,
        confidence_score: 0.8,
      }),
    ).toBe('Low')
  })
})
