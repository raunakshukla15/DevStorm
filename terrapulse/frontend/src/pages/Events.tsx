import { useState } from 'react'
import { CircleMarker, Popup } from 'react-leaflet'
import { Card } from '../components/Card'
import { HazardLegend } from '../components/Legend'
import { MapBase } from '../components/MapBase'
import { SevBadge } from '../components/SevBadge'
import { useJobs } from '../hooks/useJobs'
import { fmt, timeAgo } from '../utils/format'
import { HAZARDS, hazardColor, hazardLabel, regionName } from '../utils/geo'
import { severityOf } from '../utils/severity'

export default function Events() {
  const { jobs } = useJobs()
  const done = jobs.filter((j) => j.status === 'complete' && j.mean_db !== undefined && j.mean_db !== null)
  const [tab, setTab] = useState('all')

  const counts: Record<string, number> = { all: done.length }
  for (const h of HAZARDS) {
    counts[h.id] = done.filter((j) => j.hazard === h.id).length
  }

  const list = (tab === 'all' ? done : done.filter((j) => j.hazard === tab))
    .slice()
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Event Monitoring</h1>
      <div className="flex flex-wrap gap-2">
        {[{ id: 'all', label: 'All Events' }, ...HAZARDS.map((h) => ({ id: h.id, label: h.label }))].map((t) => (
          <button
            type="button"
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`text-sm rounded-full px-4 py-1.5 ${
              tab === t.id ? 'bg-blue-600 text-white' : 'bg-white/5 text-white/65 hover:bg-white/10'
            }`}
          >
            {t.label} ({counts[t.id] ?? 0})
          </button>
        ))}
      </div>
      <div className="grid lg:grid-cols-3 gap-4">
        <div className="space-y-2">
          {list.length === 0 && (
            <Card title="No events">
              <p>
                No completed analyses{tab !== 'all' ? ` for ${hazardLabel(tab)}` : ''} yet. Run one from
                Change Analysis.
              </p>
            </Card>
          )}
          {list.map((j) => (
            <div
              key={j.job_id}
              className="flex items-center gap-3 bg-[#0c1424] border border-white/10 rounded-xl p-3"
            >
              <span
                className="w-10 h-10 rounded-lg shrink-0 flex items-center justify-center font-bold"
                style={{ background: `${hazardColor(j.hazard)}33`, color: hazardColor(j.hazard) }}
              >
                {hazardLabel(j.hazard)[0]}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-white truncate">
                  {hazardLabel(j.hazard)} — {regionName(j.location.lat, j.location.lon)}
                </p>
                <p className="text-xs text-white/45">
                  {j.created_at ? timeAgo(j.created_at) : ''} · {fmt(j.mean_db)} dB
                </p>
              </div>
              <SevBadge level={severityOf(j)} />
            </div>
          ))}
        </div>
        <div className="lg:col-span-2 h-[480px] rounded-xl overflow-hidden border border-white/10">
          <MapBase center={[20, 20]} zoom={2}>
            {list
              .filter((j) => typeof j.location.lat === 'number' && typeof j.location.lon === 'number')
              .map((j) => (
                <CircleMarker
                  key={j.job_id}
                  center={[j.location.lat as number, j.location.lon as number]}
                  radius={10}
                  pathOptions={{
                    color: hazardColor(j.hazard),
                    fillColor: hazardColor(j.hazard),
                    fillOpacity: 0.6,
                  }}
                >
                  <Popup>
                    {hazardLabel(j.hazard)} — {regionName(j.location.lat, j.location.lon)}
                    <br />
                    {fmt(j.mean_db)} dB · {j.created_at?.slice(0, 10)}
                  </Popup>
                </CircleMarker>
              ))}
          </MapBase>
        </div>
      </div>
      <HazardLegend />
    </div>
  )
}
