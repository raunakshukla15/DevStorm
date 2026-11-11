import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { fetchJob } from '../api/analysis'
import { AnalysisResult } from '../components/AnalysisResult'
import { Card } from '../components/Card'
import { Skeleton } from '../components/Skeleton'

export default function ResultDetail() {
  const { jobId } = useParams<{ jobId: string }>()
  const jobQuery = useQuery({
    queryKey: ['job', jobId],
    queryFn: () => fetchJob(jobId as string),
    enabled: Boolean(jobId),
  })

  if (jobQuery.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-64" />
      </div>
    )
  }

  if (jobQuery.isError || !jobQuery.data) {
    return (
      <Card title="Result not found">
        <p className="text-red-300">
          Could not load job <code>{jobId}</code>. It may have expired or been removed.
        </p>
        <Link to="/change" className="text-cyan-400 underline text-xs">
          Return to Change Analysis
        </Link>
      </Card>
    )
  }

  const job = jobQuery.data
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">Analysis Report · {job.job_id}</h1>
        <span className="text-xs text-white/55">Created {job.created_at.slice(0, 19).replace('T', ' ')}</span>
      </div>
      {job.result ? (
        <AnalysisResult result={job.result} jobId={job.job_id} />
      ) : (
        <Card title={`Status: ${job.status}`}>
          <p>{job.error ?? job.stage}</p>
        </Card>
      )}
    </div>
  )
}
