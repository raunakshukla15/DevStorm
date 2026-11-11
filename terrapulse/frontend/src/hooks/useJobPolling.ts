import { useQuery } from '@tanstack/react-query'
import { fetchJob } from '../api/analysis'
import type { Job } from '../types/api'

export function useJobPolling(jobId: string | null) {
  return useQuery<Job>({
    queryKey: ['job', jobId],
    queryFn: () => fetchJob(jobId as string),
    enabled: Boolean(jobId),
    refetchInterval: (query) => {
      const status = query.state.data?.status
      if (status === 'complete' || status === 'failed') return false
      return 3000
    },
    retry: 2,
  })
}
