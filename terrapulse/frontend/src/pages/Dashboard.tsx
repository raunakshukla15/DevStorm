import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { fetchPointInsights } from '../api/analysis'
import { Card } from '../components/Card'
import { Skeleton } from '../components/Skeleton'
import { useJobs } from '../hooks/useJobs'
import { fmt, timeAgo } from '../utils/format'
import { REGIONS, hazardColor, hazardLabel, regionName } from '../utils/geo'
import { severityOf } from '../utils/severity'

export default function Dashboard() {
  const { jobs, isLoading: jobsLoading } = useJobs()
  const done = jobs.filter((j) => j.status === 'complete' && j.mean_db !== undefined && j.mean_db !== null)
  const navigate = useNavigate()

  const coverageQuery = useQuery({
    queryKey: ['dashboard-coverage'],
    queryFn: async () => {
      const all = await Promise.all(
        REGIONS.map((r) => fetchPointInsights(r.lat, r.lon).catch(() => null)),
      )
      return all.reduce((sum, v) => sum + (v?.granules_last_90d ?? 0), 0)
    },
    staleTime: 60000,
    retry: 1,
  })

  const outlines = done.reduce((s, j) => s + (j.outlines ?? 0), 0)
  const alerts = done.filter((j) => severityOf(j) !== 'Low')
  const trend = done
    .slice()
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
    .map((j) => ({
      t: String(j.created_at ?? '').slice(5, 10),
      meanDb: typeof j.mean_db === 'number' ? +j.mean_db.toFixed(2) : 0,
      changed: Math.max(j.percentage_decrease ?? 0, j.percentage_disturbed ?? 0),
    }))

  const stats = [
    { label: 'Regions Monitored', value: String(REGIONS.length), sub: 'configured areas' },
    { label: 'Surface Changes', value: outlines.toLocaleString(), sub: 'outlines from live analyses' },
    { label: 'Active Alerts', value: String(alerts.length), sub: 'medium + high findings' },
    {
      label: 'Live Granules (90d)',
      value: coverageQuery.isLoading ? '…' : String(coverageQuery.data ?? 0),
      sub: 'across monitored regions',
    },
  ]

  return (
    <div className="space-y-5">
      <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-[#0b1b33] via-[#0a1226] to-[#060b16] p-8">
        <div
          className="absolute -right-16 -top-24 w-96 h-96 rounded-full opacity-60"
          style={{
            background:
              'radial-gradient(circle at 35% 35%, #3b82f6 0%, #1d4ed8 18%, #0ea5e9 26%, transparent 45%), radial-gradient(circle at 60% 60%, #065f46 0%, transparent 40%)',
          }}
        />
        <div className="relative">
          <h1 className="text-3xl font-bold">Earth Surface Change Monitoring</h1>
          <p className="text-white/60 mt-1">Track real changes on Earth using NISAR radar data.</p>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {stats.map((s) => (
          <div key={s.label} className="bg-[#0c1424] rounded-xl border border-white/10 p-4">
            <p className="text-xs text-white/50">{s.label}</p>
            <p className="text-2xl font-bold mt-1">{s.value}</p>
            <p className="text-[11px] text-white/40">{s.sub}</p>
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card
          title="Recent Events"
          action={
            <button
              type="button"
              onClick={() => navigate('/events')}
              className="text-xs text-cyan-300 hover:underline"
            >
              View all
            </button>
          }
        >
          {jobsLoading && (
            <div className="space-y-2">
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
            </div>
          )}
          {!jobsLoading && done.length === 0 && (
            <p>No analyses run yet — results from live jobs will appear here.</p>
          )}
          {done.slice(0, 4).map((j) => (
            <div key={j.job_id} className="flex items-center gap-3 border-b border-white/5 pb-2">
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ background: hazardColor(j.hazard) }}
              />
              <div className="min-w-0">
                <p className="text-white text-sm truncate">
                  {hazardLabel(j.hazard)} indicator — {regionName(j.location.lat, j.location.lon)}
                </p>
                <p className="text-xs text-white/45">
                  {j.created_at ? timeAgo(j.created_at) : ''} · {fmt(j.mean_db)} dB mean change
                </p>
              </div>
            </div>
          ))}
        </Card>
        <Card title="Change Trends (completed live analyses)">
          {trend.length === 0 && (
            <p>Run a live analysis to start building this trend from real results.</p>
          )}
          {trend.length > 0 && (
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trend}>
                  <CartesianGrid stroke="rgba(255,255,255,0.08)" />
                  <XAxis dataKey="t" tick={{ fontSize: 11, fill: '#94a3b8' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} />
                  <Tooltip
                    contentStyle={{
                      background: '#0c1424',
                      border: '1px solid rgba(255,255,255,0.15)',
                    }}
                  />
                  <Legend />
                  <Line type="monotone" dataKey="meanDb" name="Mean Δ (dB)" stroke="#38b6ff" dot={false} />
                  <Line type="monotone" dataKey="changed" name="Changed %" stroke="#22c55e" dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
