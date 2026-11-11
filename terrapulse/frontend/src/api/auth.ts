import { apiFetch } from './client'
import type { AuthStatus, HealthStatus } from '../types/api'

export function fetchHealth(): Promise<HealthStatus> {
  return apiFetch<HealthStatus>('/health')
}

export function fetchAuthStatus(): Promise<AuthStatus> {
  return apiFetch<AuthStatus>('/auth/status')
}
