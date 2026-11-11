import type { JobSummary } from '../types/api'

export type SeverityLevel = 'High' | 'Medium' | 'Low'

export function metricOf(j: Pick<JobSummary, 'hazard' | 'percentage_disturbed' | 'percentage_decrease'>): number {
  const mag = j.hazard === 'volcano' || j.hazard === 'earthquake' || j.hazard === 'hurricane'
  return mag ? (j.percentage_disturbed ?? 0) : (j.percentage_decrease ?? 0)
}

export function severityOf(j: Pick<JobSummary, 'hazard' | 'percentage_disturbed' | 'percentage_decrease'>): SeverityLevel {
  const m = metricOf(j)
  if (m >= 40) return 'High'
  if (m >= 15) return 'Medium'
  return 'Low'
}
