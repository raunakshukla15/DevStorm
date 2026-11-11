import type { JobSummary } from '../types/api'

export type SeverityLevel = 'High' | 'Medium' | 'Low'

export const SEVERITY_RULE_TEXT =
  'High: affected area >= 2.0 km^2 AND confidence >= 0.65 (or area >= 10.0 km^2 AND confidence >= 0.45); ' +
  'Medium: affected area >= 0.25 km^2 AND confidence >= 0.45; ' +
  'Low: small footprint or low confidence.'

export function metricOf(
  j: Pick<JobSummary, 'hazard' | 'percentage_disturbed' | 'percentage_decrease'>,
): number {
  const mag =
    j.hazard === 'volcano' ||
    j.hazard === 'earthquake' ||
    j.hazard === 'hurricane' ||
    j.hazard === 'landslide' ||
    j.hazard === 'agriculture'
  return mag ? (j.percentage_disturbed ?? 0) : (j.percentage_decrease ?? 0)
}

export function severityOf(
  j: Pick<
    JobSummary,
    'hazard' | 'percentage_disturbed' | 'percentage_decrease' | 'affected_area_km2' | 'confidence_score' | 'severity'
  >,
): SeverityLevel {
  if (j.severity === 'High' || j.severity === 'Medium' || j.severity === 'Low') {
    return j.severity
  }
  const area = j.affected_area_km2 ?? 0
  const conf = j.confidence_score ?? (area > 0 ? 0.55 : 0.4)
  if ((area >= 2.0 && conf >= 0.65) || (area >= 10.0 && conf >= 0.45)) {
    return 'High'
  }
  if (area >= 0.25 && conf >= 0.45) {
    return 'Medium'
  }
  return 'Low'
}
