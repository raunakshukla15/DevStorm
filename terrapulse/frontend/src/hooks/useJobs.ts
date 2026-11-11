import { useQuery } from '@tanstack/react-query'
import { fetchJobs } from '../api/analysis'
import type { JobSummary } from '../types/api'

export function useJobs(refreshMs = 15000) {
  const query = useQuery<JobSummary[]>({
    queryKey: ['jobs'],
    queryFn: () => fetchJobs(50),
    refetchInterval: refreshMs,
    retry: 1,
  })
  return {
    jobs: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  }
}
