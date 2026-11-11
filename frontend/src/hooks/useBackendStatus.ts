import { useQuery } from '@tanstack/react-query'
import { fetchHealth } from '../api/auth'

export function useBackendStatus(): boolean | null {
  const query = useQuery({
    queryKey: ['health'],
    queryFn: fetchHealth,
    refetchInterval: 30000,
    retry: 1,
  })
  if (query.isLoading && query.data === undefined) return null
  return query.isSuccess && query.data?.status === 'healthy'
}
