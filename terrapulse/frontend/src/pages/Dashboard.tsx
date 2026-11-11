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
import { GlobeHero } from '../components/GlobeHero'
import { Skeleton } from '../components/Skeleton'
import { useJobs } from '../hooks/useJobs'
import { usePrefsStore } from '../store/usePrefsStore'
import { formatPower, timeAgo } from '../utils/format'
import { REGIONS, hazardColor, hazardLabel, regionName } from '../utils/geo'
import { severityOf } from '../utils/severity'

export default function Dashboard() {
  const { jobs, isLoading: jobsLoading } = useJobs()
  const powerUnit = usePrefsStore((s) => s.prefs.powerUnit)
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
    { label: 'Surface Changes', value: outlines.toLocaleString(), sub: 'polygons from live analyses' },
    { label: 'Active Alerts', value: String(alerts.length), sub: 'medium + high area/confidence' },
    {
      label: 'Live Granules (90d)',
      value: coverageQuery.isLoading ? '…' : String(coverageQuery.data ?? 0),
      sub: 'across monitored regions',
    },
  ]

  const globePins = [
    ...REGIONS.map((r) => ({ lat: r.lat, lon: r.lon, color: '#38bdf8', label: r.name })),
    ...done
      .filter((j) => typeof j.location.lat === 'number' && typeof j.location.lon === 'number')
      .slice(0, 12)
      .map((j) => ({
        lat: j.location.lat as number,
        lon: j.location.lon as number,
        color: hazardColor(j.hazard),
        label: hazardLabel(j.hazard),
      })),
  ]

  return (
    <div className="space-y-5">
      <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-[#0b1b33] via-[#0a1226] to-[#060b16] p-6 md:p-8 flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="space-y-3 max-w-xl">
          <h1 className="text-3xl font-bold">Earth Surface Change Monitoring</h1>
          <p className="text-white/65">
            Track real Earth-surface backscatter and interferometric change using NASA-ISRO NISAR radar data.
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              onClick={() => navigate('/change')}
              className="rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold px-4 py-2"
            >
              Launch Change Analysis
            </button>
            <button
              type="button"
              onClick={() => navigate('/explore')}
              className="rounded-lg border border-white/20 hover:bg-white/10 text-sm px-4 py-2"
            >
              Draw AOI on Map
            </button>
          </div>
        </div>
        <div className="shrink-0 hidden sm:block">
          <GlobeHero pins={globePins} />
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
            <div
              key={j.job_id}
              onClick={() => navigate(`/results/${j.job_id}`)}
              className="cursor-pointer flex items-center gap-3 border-b border-white/5 pb-2 hover:bg-white/5 rounded px-1"
            >
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ background: hazardColor(j.hazard) }}
              />
              <div className="min-w-0">
                <p className="text-white text-sm truncate">
                  {hazardLabel(j.hazard)} indicator — {regionName(j.location.lat, j.location.lon)}
                </p>
                <p className="text-xs text-white/45">
                  {j.created_at ? timeAgo(j.created_at) : ''} ·{' '}
                  {formatPower(j.mean_db, powerUnit)} mean change
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
