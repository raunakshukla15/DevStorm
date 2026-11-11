import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CircleMarker, Popup } from 'react-leaflet'
import { useNavigate } from 'react-router-dom'
import { fetchLiveEvents, matchNisarForEvent } from '../api/events'
import { Card } from '../components/Card'
import { HazardLegend } from '../components/Legend'
import { MapBase } from '../components/MapBase'
import { SevBadge } from '../components/SevBadge'
import { useJobs } from '../hooks/useJobs'
import type { LiveEvent } from '../types/api'
import { fmt, timeAgo } from '../utils/format'
import { HAZARDS, hazardColor, hazardLabel, regionName } from '../utils/geo'
import { severityOf } from '../utils/severity'

export default function Events() {
  const navigate = useNavigate()
  const { jobs } = useJobs()
  const done = jobs.filter((j) => j.status === 'complete' && j.mean_db !== undefined && j.mean_db !== null)
  const [tab, setTab] = useState('all')
  const [showLive, setShowLive] = useState(true)
  const [matchingId, setMatchingId] = useState<string | null>(null)

  const liveQuery = useQuery({
    queryKey: ['live-events', tab],
    queryFn: () => fetchLiveEvents(tab),
    staleTime: 120000,
    retry: 1,
  })

  const counts: Record<string, number> = { all: done.length }
  for (const h of HAZARDS) {
    counts[h.id] = done.filter((j) => j.hazard === h.id).length
  }

  const list = (tab === 'all' ? done : done.filter((j) => j.hazard === tab))
    .slice()
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
  const liveEvents = showLive ? (liveQuery.data?.events ?? []) : []

  const analyseEvent = async (ev: LiveEvent) => {
    setMatchingId(ev.id)
    const hz = HAZARDS.some((h) => h.id === ev.hazard) ? ev.hazard : 'earthquake'
    try {
      const m = await matchNisarForEvent(ev.lat, ev.lon, ev.date)
      navigate(
        `/change?lat=${ev.lat}&lon=${ev.lon}&hazard=${hz}&before=${m.suggested_before_date}&after=${m.suggested_after_date}`,
      )
    } catch {
      navigate(`/change?lat=${ev.lat}&lon=${ev.lon}&hazard=${hz}&auto=1`)
    } finally {
      setMatchingId(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">Event Monitoring</h1>
        <label className="text-xs flex items-center gap-2 bg-white/5 px-3 py-1.5 rounded-full">
          <input
            type="checkbox"
            checked={showLive}
            onChange={(e) => setShowLive(e.target.checked)}
          />
          Overlay live USGS &amp; NASA EONET feeds ({liveQuery.data?.events.length ?? 0})
        </label>
      </div>

      {(liveQuery.data?.warnings?.length ?? 0) > 0 && (
        <div className="text-xs text-amber-200 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
          Feed note: {liveQuery.data!.warnings.join(' · ')}
        </div>
      )}

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
        <div className="space-y-3 max-h-[540px] overflow-y-auto pr-1">
          <p className="text-xs font-semibold text-white/60 uppercase tracking-wider">
            TerraPulse Runs ({list.length})
          </p>
          {list.length === 0 && (
            <Card title="No local runs">
              <p>No completed analyses{tab !== 'all' ? ` for ${hazardLabel(tab)}` : ''} yet.</p>
            </Card>
          )}
          {list.map((j) => (
            <div
              key={j.job_id}
              onClick={() => navigate(`/results/${j.job_id}`)}
              className="cursor-pointer flex items-center gap-3 bg-[#0c1424] hover:border-cyan-500/50 border border-white/10 rounded-xl p-3"
            >
              <span
                className="w-9 h-9 rounded-lg shrink-0 flex items-center justify-center font-bold"
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

          {showLive && liveEvents.length > 0 && (
            <>
              <p className="text-xs font-semibold text-cyan-300 uppercase tracking-wider pt-2">
                Live Global Disasters (USGS + NASA EONET)
              </p>
              {liveEvents.slice(0, 20).map((ev) => (
                <div
                  key={ev.id}
                  className="bg-[#0c1424] border border-cyan-500/25 rounded-xl p-3 space-y-2 text-xs"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-medium text-white leading-snug">{ev.title}</p>
                    <span className="shrink-0 rounded bg-white/10 px-1.5 py-0.5 text-[10px]">
                      {ev.source}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-white/50">
                    <span>
                      {ev.date} · {ev.lat.toFixed(2)}, {ev.lon.toFixed(2)}
                    </span>
                    <button
                      type="button"
                      disabled={matchingId === ev.id}
                      onClick={() => analyseEvent(ev)}
                      className="rounded bg-cyan-600 hover:bg-cyan-500 text-white px-2.5 py-1 font-medium"
                    >
                      {matchingId === ev.id ? 'Matching…' : 'Analyse this event'}
                    </button>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>

        <div className="lg:col-span-2 h-[540px] rounded-xl overflow-hidden border border-white/10">
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
                    fillOpacity: 0.65,
                  }}
                >
                  <Popup>
                    <strong>{hazardLabel(j.hazard)}</strong> — {regionName(j.location.lat, j.location.lon)}
                    <br />
                    {fmt(j.mean_db)} dB · {j.created_at?.slice(0, 10)}
                  </Popup>
                </CircleMarker>
              ))}
            {liveEvents.map((ev) => (
              <CircleMarker
                key={ev.id}
                center={[ev.lat, ev.lon]}
                radius={7}
                pathOptions={{
                  color: '#facc15',
                  fillColor: hazardColor(ev.hazard),
                  fillOpacity: 0.8,
                  dashArray: '3 3',
                }}
              >
                <Popup>
                  <strong>{ev.title}</strong> ({ev.source})
                  <br />
                  Date: {ev.date}
                  {ev.magnitude ? ` · M${ev.magnitude.toFixed(1)}` : ''}
                  <br />
                  <button
                    type="button"
                    onClick={() => analyseEvent(ev)}
                    className="mt-1 underline text-blue-600 font-semibold"
                  >
                    Analyse this event in NISAR
                  </button>
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
