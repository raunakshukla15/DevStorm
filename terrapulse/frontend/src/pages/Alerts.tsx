import { Fragment, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchJob } from '../api/analysis'
import { AnalysisResult } from '../components/AnalysisResult'
import { Card } from '../components/Card'
import { SevBadge } from '../components/SevBadge'
import { useJobs } from '../hooks/useJobs'
import { usePrefsStore } from '../store/usePrefsStore'
import { hazardLabel, regionName } from '../utils/geo'
import { severityOf } from '../utils/severity'

export default function Alerts() {
  const { jobs } = useJobs()
  const [tab, setTab] = useState('all')
  const [openJobId, setOpenJobId] = useState<string | null>(null)
  const viewedIds = usePrefsStore((s) => s.viewedIds)
  const markViewed = usePrefsStore((s) => s.markViewed)

  const detailQuery = useQuery({
    queryKey: ['job', openJobId],
    queryFn: () => fetchJob(openJobId as string),
    enabled: Boolean(openJobId),
  })

  const rows = jobs
    .filter((j) => j.status === 'complete' || j.status === 'running')
    .map((j) => ({
      job: j,
      sev: j.status === 'running' ? 'Monitoring' : severityOf(j),
      status:
        j.status === 'running'
          ? 'Monitoring'
          : viewedIds.includes(j.job_id)
            ? 'Analyzed'
            : 'New',
    }))
    .sort((a, b) => String(b.job.created_at).localeCompare(String(a.job.created_at)))

  const cnt = {
    all: rows.length,
    High: rows.filter((r) => r.sev === 'High').length,
    Medium: rows.filter((r) => r.sev === 'Medium').length,
    Low: rows.filter((r) => r.sev === 'Low').length,
  }
  const list = tab === 'all' ? rows : rows.filter((r) => r.sev === tab)

  const toggleView = (jobId: string) => {
    if (openJobId === jobId) {
      setOpenJobId(null)
      return
    }
    setOpenJobId(jobId)
    markViewed(jobId)
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Alerts Center</h1>
      <p className="text-xs text-white/45">
        Severity rule (transparent): ≥40% flagged pixels → High · ≥15% → Medium · else Low.
      </p>
      <div className="flex flex-wrap gap-2">
        {[
          ['all', `All Alerts (${cnt.all})`],
          ['High', `High (${cnt.High})`],
          ['Medium', `Medium (${cnt.Medium})`],
          ['Low', `Low (${cnt.Low})`],
        ].map(([id, label]) => (
          <button
            type="button"
            key={id}
            onClick={() => setTab(id)}
            className={`text-sm rounded-full px-4 py-1.5 ${
              tab === id ? 'bg-blue-600 text-white' : 'bg-white/5 text-white/65 hover:bg-white/10'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {list.length === 0 && (
        <Card title="No alerts">
          <p>Alerts are raised from completed live analyses — none yet.</p>
        </Card>
      )}
      {list.length > 0 && (
        <div className="bg-[#0c1424] border border-white/10 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-white/50 text-xs border-b border-white/10">
                <th className="p-3">Event</th>
                <th className="p-3">Location</th>
                <th className="p-3">Severity</th>
                <th className="p-3">Detected On</th>
                <th className="p-3">Status</th>
                <th className="p-3">Action</th>
              </tr>
            </thead>
            <tbody>
              {list.map(({ job: j, sev, status }) => (
                <Fragment key={j.job_id}>
                  <tr className="border-b border-white/5">
                    <td className="p-3 text-white">{hazardLabel(j.hazard)} indicator</td>
                    <td className="p-3">{regionName(j.location.lat, j.location.lon)}</td>
                    <td className="p-3">
                      {sev === 'Monitoring' ? (
                        <span className="text-xs text-cyan-300">Monitoring</span>
                      ) : (
                        <SevBadge level={sev} />
                      )}
                    </td>
                    <td className="p-3">{String(j.created_at ?? '').slice(0, 10)}</td>
                    <td className="p-3 text-white/60">{status}</td>
                    <td className="p-3">
                      <button
                        type="button"
                        onClick={() => toggleView(j.job_id)}
                        className="text-xs bg-blue-600 rounded px-3 py-1"
                      >
                        View
                      </button>
                    </td>
                  </tr>
                  {openJobId === j.job_id && (
                    <tr>
                      <td colSpan={6} className="p-3 bg-black/30">
                        {detailQuery.data?.result ? (
                          <AnalysisResult result={detailQuery.data.result} />
                        ) : (
                          <p className="text-white/50 text-sm">Loading result…</p>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
