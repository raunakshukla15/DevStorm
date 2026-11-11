import { useState } from 'react'
import { Card } from '../components/Card'
import { useJobs } from '../hooks/useJobs'
import { usePrefsStore } from '../store/usePrefsStore'
import { fmt, formatArea } from '../utils/format'
import { hazardLabel, regionName } from '../utils/geo'

export default function CompareJobs() {
  const { jobs } = useJobs()
  const areaUnit = usePrefsStore((s) => s.prefs.areaUnit)
  const completed = jobs.filter((j) => j.status === 'complete' && j.mean_db !== null && j.mean_db !== undefined)
  const [leftId, setLeftId] = useState('')
  const [rightId, setRightId] = useState('')

  const left = completed.find((j) => j.job_id === leftId) ?? completed[0]
  const right = completed.find((j) => j.job_id === rightId) ?? completed[1]

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Compare Two Runs Side by Side</h1>
      {completed.length < 2 ? (
        <Card title="Need at least two completed runs">
          <p>Run two analyses from Change Analysis to compare locations, filters, or polarization bands.</p>
        </Card>
      ) : (
        <>
          <div className="grid md:grid-cols-2 gap-3">
            <label className="text-xs text-white/60 block">
              Run A
              <select
                value={left?.job_id ?? ''}
                onChange={(e) => setLeftId(e.target.value)}
                className="mt-1 w-full bg-[#0c1424] border border-white/15 rounded px-3 py-2 text-sm text-white"
              >
                {completed.map((j) => (
                  <option key={j.job_id} value={j.job_id}>
                    {j.job_id} · {hazardLabel(j.hazard)} · {regionName(j.location.lat, j.location.lon)}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-white/60 block">
              Run B
              <select
                value={right?.job_id ?? ''}
                onChange={(e) => setRightId(e.target.value)}
                className="mt-1 w-full bg-[#0c1424] border border-white/15 rounded px-3 py-2 text-sm text-white"
              >
                {completed.map((j) => (
                  <option key={j.job_id} value={j.job_id}>
                    {j.job_id} · {hazardLabel(j.hazard)} · {regionName(j.location.lat, j.location.lon)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            {[left, right].map((item, idx) =>
              item ? (
                <Card key={item.job_id} title={`Run ${idx === 0 ? 'A' : 'B'} · ${item.job_id}`}>
                  <p>
                    <strong>Hazard:</strong> {hazardLabel(item.hazard)}
                  </p>
                  <p>
                    <strong>Location:</strong> {regionName(item.location.lat, item.location.lon)} (
                    {item.location.lat}, {item.location.lon})
                  </p>
                  <p>
                    <strong>Mean Δ:</strong> {fmt(item.mean_db)} dB
                  </p>
                  <p>
                    <strong>Darker:</strong> {fmt(item.percentage_decrease, 1)}% · Disturbed:{' '}
                    {fmt(item.percentage_disturbed, 1)}%
                  </p>
                  <p>
                    <strong>Affected area:</strong> {formatArea(item.affected_area_km2, areaUnit)}
                  </p>
                  <p>
                    <strong>Polygons:</strong> {item.outlines}
                  </p>
                </Card>
              ) : null,
            )}
          </div>
        </>
      )}
    </div>
  )
}
