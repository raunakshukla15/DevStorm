import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import type L from 'leaflet'
import { Layers, LocateFixed } from 'lucide-react'
import { CircleMarker, Marker, Popup, useMapEvents } from 'react-leaflet'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { fetchPointInsights } from '../api/analysis'
import { geocodePlace } from '../api/geocode'
import { Card } from '../components/Card'
import { GradientLegend } from '../components/Legend'
import { MapBase } from '../components/MapBase'
import { useJobs } from '../hooks/useJobs'
import { usePrefsStore } from '../store/usePrefsStore'
import { fmt } from '../utils/format'
import { HAZARDS, REGIONS, hazardColor, hazardLabel } from '../utils/geo'

function ClickCatcher({ onPick }: { onPick: (lat: number, lon: number) => void }) {
  useMapEvents({
    click(e) {
      onPick(e.latlng.lat, e.latlng.lng)
    },
  })
  return null
}

function parseCoord(val: string | null): number | null {
  if (!val) return null
  const num = Number.parseFloat(val)
  return Number.isFinite(num) ? Math.round(num * 1000) / 1000 : null
}

export default function ExploreMap() {
  const navigate = useNavigate()
  const [params, setSearchParams] = useSearchParams()
  const prefs = usePrefsStore((s) => s.prefs)
  const [base, setBase] = useState<'esri' | 'osm'>(prefs.baseLayer === 'osm' ? 'osm' : 'esri')
  const [showRegions, setShowRegions] = useState(true)
  const [showOutlines, setShowOutlines] = useState(true)
  const [layerHz, setLayerHz] = useState('flood')
  const [rangeDays, setRangeDays] = useState(90)
  const [nowMs] = useState(() => Date.now())
  const [q, setQ] = useState('')
  const mapRef = useRef<L.Map | null>(null)
  const { jobs } = useJobs(30000)

  const paramLat = parseCoord(params.get('lat'))
  const paramLon = parseCoord(params.get('lon'))
  const paramLabel = params.get('label')

  const [clickedPt, setClickedPt] = useState<{ lat: number; lon: number; label?: string } | null>(null)
  const activePt =
    clickedPt ?? (paramLat !== null && paramLon !== null ? { lat: paramLat, lon: paramLon, label: paramLabel ?? undefined } : null)

  useEffect(() => {
    if (paramLat !== null && paramLon !== null && mapRef.current) {
      mapRef.current.flyTo([paramLat, paramLon], 7)
    }
  }, [paramLat, paramLon])

  const insightsQuery = useQuery({
    queryKey: ['point-insights', activePt?.lat, activePt?.lon],
    queryFn: () => fetchPointInsights(activePt!.lat, activePt!.lon),
    enabled: Boolean(activePt),
    retry: 1,
  })

  const pick = (lat: number, lon: number, label?: string) => {
    const rlat = Math.round(lat * 1000) / 1000
    const rlon = Math.round(lon * 1000) / 1000
    setClickedPt({ lat: rlat, lon: rlon, label })
    if (paramLat !== null || paramLon !== null) {
      setSearchParams({})
    }
  }

  const geocode = async (e: FormEvent) => {
    e.preventDefault()
    if (!q.trim()) return
    try {
      const results = await geocodePlace(q, 1)
      if (results[0]) {
        const la = Number.parseFloat(results[0].lat)
        const lo = Number.parseFloat(results[0].lon)
        mapRef.current?.flyTo([la, lo], 8)
        pick(la, lo, results[0].display_name.split(',').slice(0, 2).join(','))
      }
    } catch {
      /* ignore */
    }
  }

  const cutoff = nowMs - rangeDays * 86400000
  const outlinePts = showOutlines
    ? jobs.filter((j) => {
        if (j.status !== 'complete' || !j.actual_granule_dates) return false
        const t = new Date(j.actual_granule_dates.after ?? j.created_at).getTime()
        return t >= cutoff && typeof j.location.lat === 'number' && typeof j.location.lon === 'number'
      })
    : []

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">Explore Map</h1>
        <form onSubmit={geocode} className="flex gap-2 ml-auto">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search location, city, country…"
            className="bg-[#0c1424] border border-white/10 rounded-lg px-3 py-1.5 text-sm w-64"
          />
          <button
            type="submit"
            className="text-sm bg-cyan-600 hover:bg-cyan-500 rounded-lg px-3 py-1.5 font-medium"
          >
            Go
          </button>
        </form>
      </div>
      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 relative h-[520px] rounded-xl overflow-hidden border border-white/10">
          <MapBase center={[-1.5, -52.0]} zoom={3} baseLayer={base} mapRef={mapRef}>
            <ClickCatcher onPick={(la, lo) => pick(la, lo)} />
            {showRegions &&
              REGIONS.map((r) => (
                <Marker key={r.id} position={[r.lat, r.lon]}>
                  <Popup>
                    {r.name} — {r.detail}
                  </Popup>
                </Marker>
              ))}
            {activePt && (
              <Marker position={[activePt.lat, activePt.lon]}>
                <Popup>
                  {activePt.label ? `${activePt.label} · ` : 'Selected: '}
                  {activePt.lat}, {activePt.lon}
                </Popup>
              </Marker>
            )}
            {outlinePts.map((job) => (
              <CircleMarker
                key={job.job_id}
                center={[job.location.lat as number, job.location.lon as number]}
                radius={9}
                pathOptions={{
                  color: hazardColor(job.hazard),
                  fillColor: hazardColor(job.hazard),
                  fillOpacity: 0.55,
                }}
              >
                <Popup>
                  {hazardLabel(job.hazard)} · {fmt(job.mean_db)} dB · click View in Events
                </Popup>
              </CircleMarker>
            ))}
          </MapBase>
          <div className="absolute top-3 right-3 z-[500] bg-[#0c1424]/95 border border-white/10 rounded-xl p-3 w-52">
            <p className="text-xs font-semibold flex items-center gap-1.5 mb-2">
              <Layers size={13} /> Layers
            </p>
            <div className="space-y-1 text-xs">
              <label className="flex gap-2 items-center">
                <input type="radio" checked={base === 'esri'} onChange={() => setBase('esri')} /> Satellite
              </label>
              <label className="flex gap-2 items-center">
                <input type="radio" checked={base === 'osm'} onChange={() => setBase('osm')} /> Streets
              </label>
              <label className="flex gap-2 items-center pt-1">
                <input
                  type="checkbox"
                  checked={showRegions}
                  onChange={(e) => setShowRegions(e.target.checked)}
                />{' '}
                Monitoring regions
              </label>
              <label className="flex gap-2 items-center">
                <input
                  type="checkbox"
                  checked={showOutlines}
                  onChange={(e) => setShowOutlines(e.target.checked)}
                />{' '}
                Analysis findings
              </label>
            </div>
            <p className="text-xs font-semibold mt-2 mb-1">Click analyzes:</p>
            <div className="space-y-1 text-xs">
              {HAZARDS.map((h) => (
                <label key={h.id} className="flex gap-2 items-center">
                  <input type="radio" checked={layerHz === h.id} onChange={() => setLayerHz(h.id)} />
                  <span className="w-2 h-2 rounded-full" style={{ background: h.color }} />
                  {h.label}
                </label>
              ))}
            </div>
            <p className="text-xs font-semibold mt-2 mb-1">Findings from:</p>
            <div className="flex gap-1">
              {[30, 90].map((d) => (
                <button
                  type="button"
                  key={d}
                  onClick={() => setRangeDays(d)}
                  className={`text-xs px-2 py-0.5 rounded ${rangeDays === d ? 'bg-cyan-600' : 'bg-white/10'}`}
                >
                  {d}d
                </button>
              ))}
            </div>
          </div>
          <div className="absolute bottom-3 left-3 z-[500]">
            <GradientLegend />
          </div>
          <button
            type="button"
            onClick={() =>
              navigator.geolocation?.getCurrentPosition((p) =>
                mapRef.current?.flyTo([p.coords.latitude, p.coords.longitude], 8),
              )
            }
            className="absolute bottom-3 right-3 z-[500] bg-[#0c1424]/95 border border-white/10 rounded-lg p-2"
            title="Locate me"
          >
            <LocateFixed size={16} />
          </button>
        </div>
        <div className="space-y-3">
          {!activePt && (
            <Card title="No point selected">
              <p>Click anywhere on the map for live NISAR coverage there.</p>
            </Card>
          )}
          {activePt && (
            <Card title={`${activePt.label ?? 'Point'} · ${activePt.lat}, ${activePt.lon}`}>
              {insightsQuery.isLoading && <p>Checking live NISAR coverage…</p>}
              {insightsQuery.isError && (
                <p className="text-amber-200">
                  Could not reach backend: {insightsQuery.error.message}
                </p>
              )}
              {insightsQuery.data && !insightsQuery.data.available && (
                <p className="text-amber-200">{insightsQuery.data.note}</p>
              )}
              {insightsQuery.data && insightsQuery.data.available && (
                <>
                  <p>
                    <span className="text-white/50">Coverage (90d):</span>{' '}
                    {insightsQuery.data.granules_last_90d} granules
                  </p>
                  <p>
                    <span className="text-white/50">Latest pass:</span>{' '}
                    {insightsQuery.data.latest_acquisition}
                  </p>
                  <p className="font-semibold text-white pt-1">Detect hazard here:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {HAZARDS.map((h) => (
                      <button
                        type="button"
                        key={h.id}
                        onClick={() =>
                          navigate(`/change?lat=${activePt.lat}&lon=${activePt.lon}&hazard=${h.id}&auto=1`)
                        }
                        className={`text-xs rounded-full px-3 py-1.5 font-medium text-white ${
                          h.id === layerHz ? 'bg-cyan-600' : 'bg-white/10 hover:bg-white/20'
                        }`}
                      >
                        {h.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
