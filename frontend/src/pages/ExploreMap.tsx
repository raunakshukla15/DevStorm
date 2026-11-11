import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type L from 'leaflet'
import { Layers, LineChart, LocateFixed, Square, Trash2 } from 'lucide-react'
import { CircleMarker, Marker, Popup, Rectangle, useMapEvents } from 'react-leaflet'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { createAoi, deleteAoi, fetchAois } from '../api/aois'
import { fetchPointInsights } from '../api/analysis'
import { geocodePlace } from '../api/geocode'
import { AoiDrawControl } from '../components/AoiDrawControl'
import { Card } from '../components/Card'
import { GradientLegend } from '../components/Legend'
import { MapBase } from '../components/MapBase'
import { useJobs } from '../hooks/useJobs'
import { usePrefsStore } from '../store/usePrefsStore'
import { fmt, formatArea } from '../utils/format'
import { approxBboxAreaKm2, HAZARDS, REGIONS, hazardColor, hazardLabel } from '../utils/geo'

function ClickCatcher({
  disabled,
  onPick,
}: {
  disabled: boolean
  onPick: (lat: number, lon: number) => void
}) {
  useMapEvents({
    click(e) {
      if (!disabled) onPick(e.latlng.lat, e.latlng.lng)
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
  const qc = useQueryClient()
  const [params, setSearchParams] = useSearchParams()
  const prefs = usePrefsStore((s) => s.prefs)
  const [base, setBase] = useState<'esri' | 'osm'>(prefs.baseLayer === 'osm' ? 'osm' : 'esri')
  const [showRegions, setShowRegions] = useState(true)
  const [showOutlines, setShowOutlines] = useState(true)
  const [drawingAoi, setDrawingAoi] = useState(false)
  const [drawnBbox, setDrawnBbox] = useState<[number, number, number, number] | null>(null)
  const [aoiName, setAoiName] = useState('')
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
  const [customBefore, setCustomBefore] = useState<string | null>(null)
  const [customAfter, setCustomAfter] = useState<string | null>(null)
  const activePt =
    clickedPt ??
    (paramLat !== null && paramLon !== null
      ? { lat: paramLat, lon: paramLon, label: paramLabel ?? undefined }
      : null)

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

  const aoisQuery = useQuery({
    queryKey: ['aois'],
    queryFn: fetchAois,
    retry: 1,
  })

  const saveAoiMut = useMutation({
    mutationFn: ({ name, bbox }: { name: string; bbox: number[] }) => createAoi(name, bbox),
    onSuccess: () => {
      setAoiName('')
      toast.success('Saved Area of Interest')
      void qc.invalidateQueries({ queryKey: ['aois'] })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const delAoiMut = useMutation({
    mutationFn: deleteAoi,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['aois'] }),
  })

  const pick = (lat: number, lon: number, label?: string) => {
    const rlat = Math.round(lat * 1000) / 1000
    const rlon = Math.round(lon * 1000) / 1000
    setClickedPt({ lat: rlat, lon: rlon, label })
    setCustomBefore(null)
    setCustomAfter(null)
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

  const launchAoiAnalysis = (box: number[]) => {
    const cLat = ((box[1] + box[3]) / 2).toFixed(4)
    const cLon = ((box[0] + box[2]) / 2).toFixed(4)
    navigate(`/change?lat=${cLat}&lon=${cLon}&hazard=${layerHz}&bbox=${box.join(',')}&auto=1`)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">Explore Map</h1>
        <button
          type="button"
          onClick={() => setDrawingAoi((d) => !d)}
          className={`inline-flex items-center gap-1.5 text-sm rounded-lg px-3 py-1.5 font-medium ${
            drawingAoi ? 'bg-cyan-500 text-black' : 'bg-white/10 hover:bg-white/20 text-white'
          }`}
        >
          <Square size={14} /> {drawingAoi ? 'Drag rectangle on map…' : 'Draw AOI Box'}
        </button>
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
        <div className="lg:col-span-2 relative h-[540px] rounded-xl overflow-hidden border border-white/10">
          <MapBase center={[-1.5, -52.0]} zoom={3} baseLayer={base} mapRef={mapRef}>
            <ClickCatcher disabled={drawingAoi} onPick={(la, lo) => pick(la, lo)} />
            <AoiDrawControl
              drawing={drawingAoi}
              drawnBbox={drawnBbox}
              onDrawn={(box) => {
                setDrawnBbox(box)
                setDrawingAoi(false)
              }}
            />
            {(aoisQuery.data ?? []).map((aoi) => (
              <Rectangle
                key={aoi.id}
                bounds={[
                  [aoi.bbox[1], aoi.bbox[0]],
                  [aoi.bbox[3], aoi.bbox[2]],
                ]}
                pathOptions={{ color: '#a78bfa', weight: 1.5, fillOpacity: 0.08 }}
              >
                <Popup>
                  {aoi.name} · {formatArea(aoi.area_km2, prefs.areaUnit)}
                </Popup>
              </Rectangle>
            ))}
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
                  {hazardLabel(job.hazard)} · {fmt(job.mean_db)} dB · View in Events
                </Popup>
              </CircleMarker>
            ))}
          </MapBase>
          <div className="absolute top-3 right-3 z-[500] bg-[#0c1424]/95 border border-white/10 rounded-xl p-3 w-52 max-h-[480px] overflow-y-auto">
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
            aria-label="Center map on my location"
          >
            <LocateFixed size={16} />
          </button>
        </div>
        <div className="space-y-3">
          {drawnBbox && (
            <Card title={`Drawn AOI (${formatArea(approxBboxAreaKm2(drawnBbox), prefs.areaUnit)})`}>
              <p className="text-xs font-mono">[{drawnBbox.map((v) => v.toFixed(3)).join(', ')}]</p>
              <div className="flex gap-2">
                <input
                  value={aoiName}
                  onChange={(e) => setAoiName(e.target.value)}
                  placeholder="Name this AOI…"
                  className="flex-1 bg-white/10 rounded px-2 py-1 text-xs"
                />
                <button
                  type="button"
                  disabled={!aoiName.trim() || saveAoiMut.isPending}
                  onClick={() => saveAoiMut.mutate({ name: aoiName.trim(), bbox: drawnBbox })}
                  className="text-xs bg-white/15 hover:bg-white/25 rounded px-3 py-1 disabled:opacity-50"
                >
                  Save
                </button>
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => launchAoiAnalysis(drawnBbox)}
                  className="flex-1 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg py-1.5 text-xs font-semibold"
                >
                  Analyse AOI
                </button>
                <button
                  type="button"
                  onClick={() => setDrawnBbox(null)}
                  className="bg-white/10 hover:bg-white/20 rounded-lg px-3 py-1.5 text-xs"
                >
                  Clear
                </button>
              </div>
            </Card>
          )}

          {!activePt && (
            <Card title="No point selected">
              <p>Click anywhere on the map for live NISAR coverage, or draw an AOI box above.</p>
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
              {insightsQuery.data && insightsQuery.data.available && (() => {
                const passes = insightsQuery.data.available_passes ?? []
                const defaultAfter = passes[0]?.date ?? insightsQuery.data.latest_acquisition ?? ''
                const afterOrbit = passes[0]?.orbit_direction
                const sameOrbitOlder = afterOrbit
                  ? passes.filter((p) => p.date !== defaultAfter && p.orbit_direction === afterOrbit)
                  : []
                const olderPool =
                  sameOrbitOlder.length > 0
                    ? sameOrbitOlder
                    : passes.filter((p) => p.date !== defaultAfter)
                const defaultBefore =
                  olderPool[olderPool.length - 1]?.date ??
                  insightsQuery.data.earliest_acquisition ??
                  defaultAfter
                const selectedBefore = customBefore ?? defaultBefore
                const selectedAfter = customAfter ?? defaultAfter
                const hasPair = Boolean(selectedBefore && selectedAfter && selectedBefore !== selectedAfter)
                const dateSuffix = hasPair
                  ? `&before=${encodeURIComponent(selectedBefore)}&after=${encodeURIComponent(selectedAfter)}`
                  : '&auto=1'

                return (
                  <>
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <p>
                        <span className="text-white/50">Live passes (180d):</span>{' '}
                        <strong className="text-white">
                          {passes.length || insightsQuery.data.granules_last_180d || insightsQuery.data.granules_last_90d}
                        </strong>
                      </p>
                      {insightsQuery.data.query_elapsed_ms != null && (
                        <span className="rounded bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 text-[11px] text-emerald-200">
                          CMR {insightsQuery.data.query_elapsed_ms} ms
                        </span>
                      )}
                    </div>
                    <p className="text-xs">
                      <span className="text-white/50">Span:</span>{' '}
                      {insightsQuery.data.earliest_acquisition ?? selectedBefore} →{' '}
                      {insightsQuery.data.latest_acquisition ?? selectedAfter}
                    </p>

                    {passes.length >= 2 && (
                      <div className="space-y-2 rounded-lg bg-white/5 border border-white/10 p-2.5">
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-cyan-200">
                          Before vs After Comparison
                        </p>
                        <div className="grid grid-cols-2 gap-2">
                          <label className="text-[11px] text-white/60">
                            Before Date
                            <select
                              value={selectedBefore}
                              onChange={(e) => setCustomBefore(e.target.value)}
                              className="mt-1 w-full rounded bg-[#060b16] border border-white/15 px-2 py-1 text-xs text-white"
                            >
                              {passes.map((p) => (
                                <option key={`b-${p.date}-${p.orbit_direction}`} value={p.date}>
                                  {p.date} ({(p.orbit_direction ?? '?').slice(0, 3).toUpperCase()})
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="text-[11px] text-white/60">
                            After Date
                            <select
                              value={selectedAfter}
                              onChange={(e) => setCustomAfter(e.target.value)}
                              className="mt-1 w-full rounded bg-[#060b16] border border-white/15 px-2 py-1 text-xs text-white"
                            >
                              {passes.map((p) => (
                                <option key={`a-${p.date}-${p.orbit_direction}`} value={p.date}>
                                  {p.date} ({(p.orbit_direction ?? '?').slice(0, 3).toUpperCase()})
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            navigate(
                              `/change?lat=${activePt.lat}&lon=${activePt.lon}&hazard=${layerHz}${dateSuffix}`,
                            )
                          }
                          className="w-full rounded-lg bg-blue-600 hover:bg-blue-500 px-3 py-1.5 text-xs font-semibold text-white"
                        >
                          Compare {selectedBefore} → {selectedAfter} & Charts →
                        </button>
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={() => navigate(`/timeseries?lat=${activePt.lat}&lon=${activePt.lon}`)}
                      className="inline-flex items-center gap-1.5 text-xs bg-white/10 hover:bg-white/20 rounded-lg px-3 py-1.5 text-cyan-200"
                    >
                      <LineChart size={13} /> Open Backscatter Time Series
                    </button>
                    <p className="font-semibold text-white pt-1">Detect hazard here:</p>
                    <div className="flex flex-wrap gap-1.5">
                      {HAZARDS.map((h) => (
                        <button
                          type="button"
                          key={h.id}
                          onClick={() =>
                            navigate(`/change?lat=${activePt.lat}&lon=${activePt.lon}&hazard=${h.id}${dateSuffix}`)
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
                )
              })()}
            </Card>
          )}

          {(aoisQuery.data?.length ?? 0) > 0 && (
            <Card title="Saved AOIs">
              <div className="space-y-1.5 max-h-40 overflow-y-auto">
                {aoisQuery.data!.map((aoi) => (
                  <div
                    key={aoi.id}
                    className="flex items-center justify-between gap-2 text-xs bg-white/5 rounded px-2.5 py-1.5"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setDrawnBbox(aoi.bbox as [number, number, number, number])
                        mapRef.current?.fitBounds([
                          [aoi.bbox[1], aoi.bbox[0]],
                          [aoi.bbox[3], aoi.bbox[2]],
                        ])
                      }}
                      className="text-left truncate flex-1 hover:text-cyan-300"
                    >
                      {aoi.name} · {formatArea(aoi.area_km2, prefs.areaUnit)}
                    </button>
                    <button
                      type="button"
                      onClick={() => launchAoiAnalysis(aoi.bbox)}
                      className="text-cyan-300 hover:underline"
                    >
                      Run
                    </button>
                    <button
                      type="button"
                      onClick={() => delAoiMut.mutate(aoi.id)}
                      className="text-red-400 hover:text-red-300"
                      aria-label={`Delete AOI ${aoi.name}`}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
