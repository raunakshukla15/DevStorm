import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchJob } from '../api/analysis'
import { API_BASE } from '../api/client'
import type { Job } from '../types/api'

export function useJobPolling(jobId: string | null) {
  const qc = useQueryClient()

  const query = useQuery<Job>({
    queryKey: ['job', jobId],
    queryFn: () => fetchJob(jobId as string),
    enabled: Boolean(jobId),
    refetchInterval: (q) => {
      const status = q.state.data?.status
      if (status === 'complete' || status === 'completed' || status === 'failed') return false
      return 3000
    },
    retry: 2,
  })

  useEffect(() => {
    if (!jobId || typeof EventSource === 'undefined') return
    const es = new EventSource(`${API_BASE}/analysis/jobs/${encodeURIComponent(jobId)}/stream`)
    es.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data) as {
          status?: string
          stage?: string
          progress?: number
          error?: string | null
        }
        qc.setQueryData<Job>(['job', jobId], (prev) =>
          prev
            ? {
                ...prev,
                status: msg.status ?? prev.status,
                stage: msg.stage ?? prev.stage,
                progress: msg.progress ?? prev.progress,
                error: msg.error ?? prev.error,
              }
            : prev,
        )
        if (msg.status === 'complete' || msg.status === 'completed' || msg.status === 'failed') {
          es.close()
          void qc.invalidateQueries({ queryKey: ['job', jobId] })
        }
      } catch {
        /* ignore malformed event */
      }
    }
    es.onerror = () => {
      es.close()
    }
    return () => es.close()
  }, [jobId, qc])

  return query
}
