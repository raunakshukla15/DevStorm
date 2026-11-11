import { useState } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Card } from '../components/Card'
import { useJobs } from '../hooks/useJobs'
import { downloadFile, fmt } from '../utils/format'
import { REGIONS, hazardLabel, regionName } from '../utils/geo'
import { metricOf } from '../utils/severity'

export default function Reports() {
  const { jobs } = useJobs()
  const done = jobs
    .filter((j) => j.status === 'complete' && j.mean_db !== undefined && j.mean_db !== null)
    .slice()
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
  const [tab, setTab] = useState('overview')
  const [region, setRegion] = useState('all')

  const filtered =
    region === 'all'
      ? done
      : done.filter((j) => regionName(j.location.lat, j.location.lon) === REGIONS.find((r) => r.id === region)?.name)

  const trend = filtered.map((j) => ({
    t: String(j.created_at ?? '').slice(5, 10),
    meanDb: typeof j.mean_db === 'number' ? +j.mean_db.toFixed(2) : 0,
    changed: Math.max(j.percentage_decrease ?? 0, j.percentage_disturbed ?? 0),
  }))

  const insights = filtered.slice(-4).reverse().map((j) => {
    const m = metricOf(j)
    return `${hazardLabel(j.hazard)} near ${regionName(j.location.lat, j.location.lon)}: mean Δ ${fmt(j.mean_db)} dB, ${fmt(m, 1)}% pixels flagged (${j.actual_granule_dates?.before} → ${j.actual_granule_dates?.after}).`
  })

  const csv = () => {
    const head = 'job_id,hazard,lat,lon,before,after,mean_db,decrease_pct,disturbed_pct,area_km2,outlines,created_at'
    const lines = filtered.map((j) =>
      [
        j.job_id,
        j.hazard,
        j.location.lat,
        j.location.lon,
        j.actual_granule_dates?.before ?? '',
        j.actual_granule_dates?.after ?? '',
        j.mean_db ?? '',
        j.percentage_decrease ?? '',
        j.percentage_disturbed ?? '',
        j.affected_area_km2 ?? '',
        j.outlines ?? '',
        j.created_at ?? '',
      ].join(','),
    )
    downloadFile('terrapulse-report.csv', [head, ...lines].join('\n'), 'text/csv')
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold">Reports &amp; Insights</h1>
        <div className="ml-auto flex gap-2">
          {['overview', 'trends', 'regional'].map((t) => (
            <button
              type="button"
              key={t}
              onClick={() => setTab(t)}
              className={`text-sm rounded-lg px-3 py-1.5 capitalize ${
                tab === t ? 'bg-blue-600' : 'bg-white/5 text-white/65'
              }`}
            >
              {t === 'regional' ? 'Regional Insights' : t}
            </button>
          ))}
          <button
            type="button"
            onClick={() => window.print()}
            className="text-sm border border-white/15 rounded-lg px-3 py-1.5"
          >
            Download Report
          </button>
        </div>
      </div>
      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <Card title="Surface Change Trend">
            {trend.length === 0 && (
              <p>No completed analyses yet — the trend builds from real results.</p>
            )}
            {trend.length > 0 && (
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={trend}>
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
                    <Area
                      type="monotone"
                      dataKey="meanDb"
                      name="Mean Δ (dB)"
                      stroke="#38b6ff"
                      fill="#38b6ff33"
                    />
                    <Area
                      type="monotone"
                      dataKey="changed"
                      name="Changed %"
                      stroke="#22c55e"
                      fill="#22c55e33"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>
          <Card title="Key Insights">
            {insights.length === 0 && (
              <p>Insights are generated from completed live analyses — none yet.</p>
            )}
            <ul className="list-disc pl-5 space-y-1">
              {insights.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </Card>
        </div>
        <Card title="Generate Report">
          <label className="text-xs">
            Region{' '}
            <select
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              className="mt-1 w-full bg-white/10 rounded px-2 py-1.5"
            >
              <option value="all">All regions</option>
              {REGIONS.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          <p className="text-xs pt-2">{filtered.length} completed analyses in scope.</p>
          <button
            type="button"
            onClick={() => window.print()}
            className="w-full bg-blue-600 hover:bg-blue-500 rounded-lg px-4 py-2 text-sm font-semibold"
          >
            Generate PDF Report
          </button>
          <button
            type="button"
            onClick={csv}
            className="w-full border border-white/15 rounded-lg px-4 py-2 text-sm"
          >
            Download CSV Data
          </button>
          <button
            type="button"
            onClick={() =>
              downloadFile(
                'terrapulse-report.json',
                JSON.stringify(filtered, null, 2),
                'application/json',
              )
            }
            className="w-full border border-white/15 rounded-lg px-4 py-2 text-sm"
          >
            Download JSON
          </button>
        </Card>
      </div>
    </div>
  )
}
