import { useEffect, useRef, useState } from 'react'
import { BrowserRouter, NavLink, Route, Routes, useNavigate, useSearchParams } from 'react-router-dom'
import { CircleMarker, MapContainer, Marker, Popup, TileLayer, useMapEvents } from 'react-leaflet'
import {
  Activity, Bell, Database, FileText, FlaskConical, Info, Layers,
  LayoutDashboard, LocateFixed, Map as MapIcon, MapPin, Satellite,
  Search, Settings as SettingsIcon,
} from 'lucide-react'
import { Area, AreaChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import 'leaflet/dist/leaflet.css'
import './index.css'

const API_BASE = 'http://localhost:8001/api/v1'
const LAST_RESULT_KEY = 'terrapulse:lastResult'
const VIEWED_KEY = 'terrapulse:viewedIds'
const PREFS_KEY = 'terrapulse:prefs'

const REGIONS = [
  { id: 'amazon', name: 'Amazon Basin', detail: 'Brazil', lat: -1.5, lon: -52.0 },
  { id: 'mekong', name: 'Mekong Delta', detail: 'Vietnam', lat: 10.0, lon: 105.0 },
  { id: 'sahel', name: 'Sahel Region', detail: 'Niger · Nigeria · Chad', lat: 13.5, lon: 2.1 },
  { id: 'andean', name: 'Andean Region', detail: 'Peru · Bolivia · Argentina', lat: -13.0, lon: -72.0 },
]

const HAZARDS = [
  { id: 'flood', label: 'Flood', color: '#38bdf8' },
  { id: 'tsunami', label: 'Tsunami', color: '#22d3ee' },
  { id: 'hurricane', label: 'Hurricane', color: '#a78bfa' },
  { id: 'volcano', label: 'Volcano', color: '#fb923c' },
  { id: 'earthquake', label: 'Earthquake', color: '#f87171' },
]

/* ---------------- helpers ---------------- */

function fmt(n: any, digits = 3) {
  return typeof n === 'number' && isFinite(n) ? n.toFixed(digits) : 'n/a'
}

function timeAgo(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} hours ago`
  return `${Math.floor(s / 86400)} days ago`
}

function hazardColor(id: string) {
  return HAZARDS.find((h) => h.id === id)?.color ?? '#94a3b8'
}

function hazardLabel(id: string) {
  return HAZARDS.find((h) => h.id === id)?.label ?? id
}

function metricOf(j: any) {
  const mag = j.hazard === 'volcano' || j.hazard === 'earthquake' || j.hazard === 'hurricane'
  return mag ? (j.percentage_disturbed ?? 0) : (j.percentage_decrease ?? 0)
}

function severityOf(j: any): 'High' | 'Medium' | 'Low' {
  const m = metricOf(j)
  if (m >= 40) return 'High'
  if (m >= 15) return 'Medium'
  return 'Low'
}

function regionName(lat: number, lon: number) {
  let best: any = null, bd = 1e9
  for (const r of REGIONS) {
    const d = Math.hypot(r.lat - lat, r.lon - lon)
    if (d < bd) { bd = d; best = r }
  }
  return bd < 4 ? best.name : `${lat.toFixed(2)}, ${lon.toFixed(2)}`
}

function getViewed(): string[] {
  try { return JSON.parse(localStorage.getItem(VIEWED_KEY) ?? '[]') } catch { return [] }
}
function markViewed(id: string) {
  try {
    const v = new Set(getViewed()); v.add(id)
    localStorage.setItem(VIEWED_KEY, JSON.stringify([...v]))
  } catch { /* ignore */ }
}

function getPrefs() {
  try { return { defaultHazard: 'flood', autoDates: true, defaultRegion: 'amazon', baseLayer: 'esri', ...(JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}')) } }
  catch { return { defaultHazard: 'flood', autoDates: true, defaultRegion: 'amazon', baseLayer: 'esri' } }
}

function useJobs(refreshMs = 15000) {
  const [jobs, setJobs] = useState<any[]>([])
  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const r = await fetch(`${API_BASE}/analysis/jobs?limit=50`)
        if (r.ok && alive) setJobs(await r.json())
      } catch { /* backend down: keep old list */ }
    }
    load()
    const t = window.setInterval(load, refreshMs)
    return () => { alive = false; window.clearInterval(t) }
  }, [refreshMs])
  return jobs
}

function useBackendStatus() {
  const [ok, setOk] = useState<boolean | null>(null)
  useEffect(() => {
    fetch(`${API_BASE}/health`).then((r) => setOk(r.ok)).catch(() => setOk(false))
  }, [])
  return ok
}

/* ---------------- shared UI ---------------- */

function Card({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="bg-[#0c1424] rounded-xl border border-white/10 p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold">{title}</h2>
        {action}
      </div>
      <div className="text-sm text-white/70 space-y-2">{children}</div>
    </section>
  )
}

function SevBadge({ level }: { level: string }) {
  const cls = level === 'High' ? 'bg-red-500/20 text-red-300 border-red-500/30'
    : level === 'Medium' ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
    : 'bg-sky-500/20 text-sky-300 border-sky-500/30'
  return <span className={`text-xs font-medium border rounded-full px-2.5 py-0.5 ${cls}`}>{level}</span>
}

function Granule({ label, g }: { label: string; g: any }) {
  if (!g) return null
  return (
    <div className="border border-white/10 rounded-lg p-3 space-y-1">
      <p className="font-semibold text-white text-sm">{label}</p>
      <p className="break-all text-xs">{g.title}</p>
      <p className="text-xs">Acquired {g.acquisition_date ?? 'unknown'} · {g.short_name} · orbit {g.orbit_direction ?? 'unknown'}</p>
      {g.https_url && <p className="text-xs break-all">File: <a className="text-cyan-300 underline" href={g.https_url} target="_blank" rel="noreferrer">download</a></p>}
    </div>
  )
}

function AnalysisResult({ result }: { result: any }) {
  const a = result.analysis
  const resVals = result.results ? Object.values(result.results) : []
  const feats = (resVals.find((v: any) => v && Array.isArray(v.features)) as any)?.features ?? []
  return (
    <div className="space-y-4">
      <Card title={result.status === 'metadata_only' ? 'Granules found — pixels not streamed' : `Live result · ${result.hazard_label ?? 'change'}`}>
        <p><span className="text-white/50">Source:</span> {result.data_source}</p>
        {result.short_name && <p><span className="text-white/50">Collection:</span> {result.short_name}</p>}
        {result.interpretation && <p className="text-cyan-100/90">{result.interpretation}</p>}
        {result.auto_dates && result.actual_granule_dates && (
          <p className="text-xs">Auto pair: {result.actual_granule_dates.before} → {result.actual_granule_dates.after}</p>
        )}
        {result.processing_note && <p className="text-amber-200">{result.processing_note}</p>}
        {a && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 pt-1">
            <div className="bg-white/5 rounded-lg p-3"><p className="text-white/50 text-xs">Mean Δ (dB)</p><p className="text-white text-lg font-semibold">{fmt(a.mean_backscatter_difference_db)}</p></div>
            <div className="bg-white/5 rounded-lg p-3"><p className="text-white/50 text-xs">Pixels darker</p><p className="text-white text-lg font-semibold">{fmt(a.percentage_decrease, 1)}%</p></div>
            {a.percentage_disturbed !== undefined && (
              <div className="bg-white/5 rounded-lg p-3"><p className="text-white/50 text-xs">Pixels disturbed</p><p className="text-white text-lg font-semibold">{fmt(a.percentage_disturbed, 1)}%</p></div>
            )}
            <div className="bg-white/5 rounded-lg p-3"><p className="text-white/50 text-xs">Outlines</p><p className="text-white text-lg font-semibold">{feats.length}</p></div>
          </div>
        )}
        <div className="grid md:grid-cols-2 gap-2 pt-1">
          <Granule label="Before granule" g={result.before_granule} />
          <Granule label="After granule" g={result.after_granule} />
        </div>
        {result.caveats_and_limitations && (
          <>
            <p className="font-semibold text-white pt-2">Limitations — read before concluding anything</p>
            <ul className="list-disc pl-5 space-y-1">
              {result.caveats_and_limitations.map((c: string, i: number) => <li key={i}>{c}</li>)}
            </ul>
          </>
        )}
      </Card>
    </div>
  )
}

/* ---------------- 1. Dashboard ---------------- */

function Dashboard() {
  const jobs = useJobs()
  const done = jobs.filter((j) => j.status === 'complete' && j.mean_db !== undefined)
  const [granuleCount, setGranuleCount] = useState<number | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    let alive = true
    Promise.all(REGIONS.map((r) =>
      fetch(`${API_BASE}/analysis/point-insights?lat=${r.lat}&lon=${r.lon}`)
        .then((x) => (x.ok ? x.json() : null)).catch(() => null)))
      .then((all) => {
        if (!alive) return
        const total = all.reduce((s, v) => s + (v?.granules_last_90d ?? 0), 0)
        setGranuleCount(total)
      })
    return () => { alive = false }
  }, [])

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
    { label: 'Live Granules (90d)', value: granuleCount === null ? '…' : String(granuleCount), sub: 'across monitored regions' },
  ]

  return (
    <div className="space-y-5">
      <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-[#0b1b33] via-[#0a1226] to-[#060b16] p-8">
        <div className="absolute -right-16 -top-24 w-96 h-96 rounded-full opacity-60"
          style={{ background: 'radial-gradient(circle at 35% 35%, #3b82f6 0%, #1d4ed8 18%, #0ea5e9 26%, transparent 45%), radial-gradient(circle at 60% 60%, #065f46 0%, transparent 40%)' }} />
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
        <Card title="Recent Events" action={<button onClick={() => navigate('/events')} className="text-xs text-cyan-300 hover:underline">View all</button>}>
          {done.length === 0 && <p>No analyses run yet — results from live jobs will appear here.</p>}
          {done.slice(0, 4).map((j) => (
            <div key={j.job_id} className="flex items-center gap-3 border-b border-white/5 pb-2">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: hazardColor(j.hazard) }} />
              <div className="min-w-0">
                <p className="text-white text-sm truncate">{hazardLabel(j.hazard)} indicator — {regionName(j.location.lat, j.location.lon)}</p>
                <p className="text-xs text-white/45">{j.created_at ? timeAgo(j.created_at) : ''} · {fmt(j.mean_db)} dB mean change</p>
              </div>
            </div>
          ))}
        </Card>
        <Card title="Change Trends (completed live analyses)">
          {trend.length === 0 && <p>Run a live analysis to start building this trend from real results.</p>}
          {trend.length > 0 && (
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trend}>
                  <CartesianGrid stroke="rgba(255,255,255,0.08)" />
                  <XAxis dataKey="t" tick={{ fontSize: 11, fill: '#94a3b8' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} />
                  <Tooltip contentStyle={{ background: '#0c1424', border: '1px solid rgba(255,255,255,0.15)' }} />
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

/* ---------------- 2. Explore Map ---------------- */

function ClickCatcher({ onPick }: { onPick: (lat: number, lon: number) => void }) {
  useMapEvents({ click(e) { onPick(e.latlng.lat, e.latlng.lng) } })
  return null
}

function ExploreMap() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const prefs = getPrefs()
  const [base, setBase] = useState(prefs.baseLayer === 'osm' ? 'osm' : 'esri')
  const [showRegions, setShowRegions] = useState(true)
  const [showOutlines, setShowOutlines] = useState(true)
  const [layerHz, setLayerHz] = useState('flood')
  const [rangeDays, setRangeDays] = useState(90)
  const [pt, setPt] = useState<{ lat: number; lon: number } | null>(null)
  const [info, setInfo] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [geo, setGeo] = useState<{ label: string; lat: number; lon: number } | null>(null)
  const [q, setQ] = useState('')
  const mapRef = useRef<any>(null)
  const jobs = useJobs(30000)

  const pick = async (lat: number, lon: number, label?: string) => {
    const rlat = Math.round(lat * 1000) / 1000
    const rlon = Math.round(lon * 1000) / 1000
    setPt({ lat: rlat, lon: rlon })
    if (label) setGeo({ label, lat: rlat, lon: rlon })
    setInfo(null); setLoading(true)
    try {
      const r = await fetch(`${API_BASE}/analysis/point-insights?lat=${rlat}&lon=${rlon}`)
      setInfo(await r.json())
    } catch (e: any) {
      setInfo({ available: false, note: 'Could not reach backend: ' + (e.message ?? e) })
    } finally { setLoading(false) }
  }

  useEffect(() => {
    const lat = params.get('lat'), lon = params.get('lon'), label = params.get('label')
    if (lat && lon) {
      const la = parseFloat(lat), lo = parseFloat(lon)
      if (isFinite(la) && isFinite(lo)) {
        pick(la, lo, label ?? undefined)
        if (mapRef.current) mapRef.current.flyTo([la, lo], 7)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params])

  const geocode = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!q.trim()) return
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(q)}&limit=1`)
      const j = await r.json()
      if (j && j[0]) {
        const la = parseFloat(j[0].lat), lo = parseFloat(j[0].lon)
        if (mapRef.current) mapRef.current.flyTo([la, lo], 8)
        pick(la, lo, j[0].display_name?.split(',').slice(0, 2).join(','))
      }
    } catch { /* ignore */ }
  }

  const cutoff = Date.now() - rangeDays * 86400000
  const outlinePts: any[] = []
  if (showOutlines) {
    for (const j of jobs) {
      if (j.status !== 'complete' || !j.actual_granule_dates) continue
      const t = new Date(j.actual_granule_dates.after ?? j.created_at).getTime()
      if (t < cutoff) continue
      outlinePts.push({ job: j })
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">Explore Map</h1>
        <form onSubmit={geocode} className="flex gap-2 ml-auto">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search location, city, country…"
            className="bg-[#0c1424] border border-white/10 rounded-lg px-3 py-1.5 text-sm w-64" />
          <button className="text-sm bg-cyan-600 hover:bg-cyan-500 rounded-lg px-3 py-1.5 font-medium">Go</button>
        </form>
      </div>
      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 relative h-[520px] rounded-xl overflow-hidden border border-white/10">
          <MapContainer center={[-1.5, -52.0]} zoom={3} style={{ height: '100%', width: '100%' }} ref={mapRef}>
            {base === 'esri' ? (
              <TileLayer attribution="Esri World Imagery" url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" />
            ) : (
              <TileLayer attribution="&copy; OpenStreetMap" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            )}
            <ClickCatcher onPick={(la, lo) => { setGeo(null); pick(la, lo) }} />
            {showRegions && REGIONS.map((r) => (
              <Marker key={r.id} position={[r.lat, r.lon]}><Popup>{r.name} — {r.detail}</Popup></Marker>
            ))}
            {pt && <Marker position={[pt.lat, pt.lon]}><Popup>Selected: {pt.lat}, {pt.lon}</Popup></Marker>}
            {geo && <Marker position={[geo.lat, geo.lon]}><Popup>{geo.label}</Popup></Marker>}
            {outlinePts.map(({ job }) => (
              <CircleMarker key={job.job_id} center={[job.location.lat, job.location.lon]} radius={9}
                pathOptions={{ color: hazardColor(job.hazard), fillColor: hazardColor(job.hazard), fillOpacity: 0.55 }}>
                <Popup>{hazardLabel(job.hazard)} · {fmt(job.mean_db)} dB · click View in Events</Popup>
              </CircleMarker>
            ))}
          </MapContainer>
          <div className="absolute top-3 right-3 z-[500] bg-[#0c1424]/95 border border-white/10 rounded-xl p-3 w-52">
            <p className="text-xs font-semibold flex items-center gap-1.5 mb-2"><Layers size={13} /> Layers</p>
            <div className="space-y-1 text-xs">
              <label className="flex gap-2 items-center"><input type="radio" checked={base === 'esri'} onChange={() => setBase('esri')} /> Satellite</label>
              <label className="flex gap-2 items-center"><input type="radio" checked={base === 'osm'} onChange={() => setBase('osm')} /> Streets</label>
              <label className="flex gap-2 items-center pt-1"><input type="checkbox" checked={showRegions} onChange={(e) => setShowRegions(e.target.checked)} /> Monitoring regions</label>
              <label className="flex gap-2 items-center"><input type="checkbox" checked={showOutlines} onChange={(e) => setShowOutlines(e.target.checked)} /> Analysis findings</label>
            </div>
            <p className="text-xs font-semibold mt-2 mb-1">Click analyzes:</p>
            <div className="space-y-1 text-xs">
              {HAZARDS.map((h) => (
                <label key={h.id} className="flex gap-2 items-center">
                  <input type="radio" checked={layerHz === h.id} onChange={() => setLayerHz(h.id)} />
                  <span className="w-2 h-2 rounded-full" style={{ background: h.color }} />{h.label}
                </label>
              ))}
            </div>
            <p className="text-xs font-semibold mt-2 mb-1">Findings from:</p>
            <div className="flex gap-1">
              {[30, 90].map((d) => (
                <button key={d} onClick={() => setRangeDays(d)} className={`text-xs px-2 py-0.5 rounded ${rangeDays === d ? 'bg-cyan-600' : 'bg-white/10'}`}>{d}d</button>
              ))}
            </div>
          </div>
          <div className="absolute bottom-3 left-3 z-[500] bg-[#0c1424]/95 border border-white/10 rounded-xl px-3 py-2">
            <p className="text-[11px] font-semibold">Change intensity (dB)</p>
            <div className="w-36 h-2 rounded-full" style={{ background: 'linear-gradient(90deg,#0ea5e9,#22c55e,#eab308,#ef4444)' }} />
            <div className="flex justify-between text-[10px] text-white/50"><span>Low</span><span>High</span></div>
          </div>
          <button onClick={() => navigator.geolocation?.getCurrentPosition((p) => mapRef.current?.flyTo([p.coords.latitude, p.coords.longitude], 8))}
            className="absolute bottom-3 right-3 z-[500] bg-[#0c1424]/95 border border-white/10 rounded-lg p-2" title="Locate me">
            <LocateFixed size={16} />
          </button>
        </div>
        <div className="space-y-3">
          {!pt && <Card title="No point selected"><p>Click anywhere on the map for live NISAR coverage there.</p></Card>}
          {pt && (
            <Card title={`${geo?.label ?? 'Point'} · ${pt.lat}, ${pt.lon}`}>
              {loading && <p>Checking live NISAR coverage…</p>}
              {info && !info.available && <p className="text-amber-200">{info.note}</p>}
              {info && info.available && (
                <>
                  <p><span className="text-white/50">Coverage (90d):</span> {info.granules_last_90d} granules</p>
                  <p><span className="text-white/50">Latest pass:</span> {info.latest_acquisition}</p>
                  <p className="font-semibold text-white pt-1">Detect hazard here:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {HAZARDS.map((h) => (
                      <button key={h.id} onClick={() => navigate(`/change?lat=${pt.lat}&lon=${pt.lon}&hazard=${h.id}&auto=1`)}
                        className={`text-xs rounded-full px-3 py-1.5 font-medium text-white ${h.id === layerHz ? 'bg-cyan-600' : 'bg-white/10 hover:bg-white/20'}`}>
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

/* ---------------- 3. Change Analysis ---------------- */

function ChangeAnalysis() {
  const [params] = useSearchParams()
  const [jobId, setJobId] = useState<string | null>(null)
  const [stage, setStage] = useState('')
  const [progress, setProgress] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const [result, setResult] = useState<any>(null)
  const [previews, setPreviews] = useState<{ before?: string; after?: string }>({})
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [detail, setDetail] = useState(false)
  const poller = useRef<number | null>(null)
  const timer = useRef<number | null>(null)
  const prefs = getPrefs()
  const [form, setForm] = useState({ place: '', before: '2026-09-01', after: '2026-09-13', lat: '-1.5', lon: '-52.0' })
  const [hazard, setHazard] = useState(prefs.defaultHazard ?? 'flood')
  const [auto, setAuto] = useState(prefs.autoDates !== false)

  useEffect(() => {
    const lat = params.get('lat'), lon = params.get('lon'), hz = params.get('hazard'), au = params.get('auto')
    if (hz && HAZARDS.some((h) => h.id === hz)) setHazard(hz)
    if (au === '1') setAuto(true)
    setForm((f) => ({ ...f, ...(lat ? { lat } : {}), ...(lon ? { lon } : {}) }))
    try {
      const raw = localStorage.getItem(LAST_RESULT_KEY)
      if (raw) setResult(JSON.parse(raw))
    } catch { /* ignore */ }
    return () => {
      if (poller.current) window.clearInterval(poller.current)
      if (timer.current) window.clearInterval(timer.current)
    }
  }, [params])

  const stopTimers = () => {
    if (poller.current) window.clearInterval(poller.current)
    if (timer.current) window.clearInterval(timer.current)
    poller.current = timer.current = null
  }

  const geocodePlace = async () => {
    if (!form.place.trim()) return
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(form.place)}&limit=1`)
      const j = await r.json()
      if (j?.[0]) setForm((f) => ({ ...f, lat: String(+parseFloat(j[0].lat).toFixed(3)), lon: String(+parseFloat(j[0].lon).toFixed(3)) }))
      else setError(`No place found for “${form.place}”. Try coordinates instead.`)
    } catch { setError('Place search unreachable — enter coordinates directly.') }
  }

  const run = async (e: React.FormEvent) => {
    e.preventDefault()
    const lat = parseFloat(form.lat), lon = parseFloat(form.lon)
    if (!isFinite(lat) || lat < -90 || lat > 90 || !isFinite(lon) || lon < -180 || lon > 180) {
      setError('Latitude must be −90…90, longitude −180…180.'); return
    }
    const q = new URLSearchParams({ hazard, lat: String(lat), lon: String(lon), dataset_id: 'nisar_l2_gcov', band: 'HH' })
    if (!auto) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(form.before) || !/^\d{4}-\d{2}-\d{2}$/.test(form.after)) {
        setError('Dates must be YYYY-MM-DD (or tick auto dates).'); return
      }
      if (new Date(form.after) <= new Date(form.before)) { setError('After date must be after before date.'); return }
      if ((new Date(form.after).getTime() - new Date(form.before).getTime()) / 86400000 < 12) {
        setError('Use dates at least 12 days apart (NISAR revisit cycle).'); return
      }
      q.set('before_date', form.before); q.set('after_date', form.after)
    }
    setError(null); setResult(null); setPreviews({}); setRunning(true); setDetail(false)
    setStage('starting job'); setProgress(2); setElapsed(0)
    const t0 = Date.now()
    timer.current = window.setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 1000)
    try {
      const r = await fetch(`${API_BASE}/analysis/hazard?${q}`, { method: 'POST' })
      const j = await r.json()
      if (!r.ok) throw new Error(j.detail ?? 'job start failed')
      setJobId(j.job_id)
      poller.current = window.setInterval(async () => {
        try {
          const s = await (await fetch(`${API_BASE}/analysis/jobs/${j.job_id}`)).json()
          setStage(s.stage ?? ''); setProgress(s.progress ?? 0)
          if (s.status === 'complete') {
            stopTimers(); setRunning(false); setResult(s.result)
            setPreviews({ before: s.result?.before_granule?.browse_url, after: s.result?.after_granule?.browse_url })
            try { localStorage.setItem(LAST_RESULT_KEY, JSON.stringify(s.result)) } catch { /* ignore */ }
          } else if (s.status === 'failed') {
            stopTimers(); setRunning(false); setError(s.error ?? 'analysis failed')
          }
        } catch (err: any) {
          stopTimers(); setRunning(false); setError('Lost contact with backend: ' + (err.message ?? err))
        }
      }, 5000)
    } catch (err: any) {
      stopTimers(); setRunning(false); setError(err.message ?? 'could not start job')
    }
  }

  const mmss = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`
  const a = result?.analysis

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Change Analysis</h1>
      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <form onSubmit={run} className="bg-[#0c1424] p-5 rounded-xl border border-white/10 space-y-3">
            <div className="flex flex-wrap gap-2">
              {HAZARDS.map((h) => (
                <button type="button" key={h.id} onClick={() => setHazard(h.id)}
                  className={`text-sm rounded-full px-4 py-1.5 font-medium ${hazard === h.id ? 'bg-cyan-600 text-white' : 'border border-white/15 text-white/70 hover:bg-white/10'}`}>
                  {h.label}
                </button>
              ))}
            </div>
            <div className="grid md:grid-cols-3 gap-3">
              <label className="text-sm md:col-span-1">Location
                <span className="flex gap-1 mt-1">
                  <input value={form.place} onChange={(e) => setForm({ ...form, place: e.target.value })} placeholder="Assam, India" className="w-full bg-white/10 rounded px-2 py-1.5" />
                  <button type="button" onClick={geocodePlace} className="bg-white/10 rounded px-2" title="Find coordinates"><Search size={14} /></button>
                </span>
                <span className="text-xs text-white/50">{form.lat}, {form.lon} — <button type="button" className="underline" onClick={() => setForm((f) => ({ ...f, lat: String(f.lat), lon: String(f.lon) }))}>edit below</button></span>
              </label>
              {!auto && <label className="text-sm">Before<input value={form.before} onChange={(e) => setForm({ ...form, before: e.target.value })} className="mt-1 w-full bg-white/10 rounded px-2 py-1.5" /></label>}
              {!auto && <label className="text-sm">After<input value={form.after} onChange={(e) => setForm({ ...form, after: e.target.value })} className="mt-1 w-full bg-white/10 rounded px-2 py-1.5" /></label>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-sm">Latitude<input value={form.lat} onChange={(e) => setForm({ ...form, lat: e.target.value })} className="mt-1 w-full bg-white/10 rounded px-2 py-1.5" /></label>
              <label className="text-sm">Longitude<input value={form.lon} onChange={(e) => setForm({ ...form, lon: e.target.value })} className="mt-1 w-full bg-white/10 rounded px-2 py-1.5" /></label>
            </div>
            <label className="text-sm flex items-center gap-2">
              <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
              Auto dates — newest suitable granule pair (recommended)
            </label>
            <button disabled={running} className="w-full md:w-auto bg-blue-600 hover:bg-blue-500 rounded-lg px-8 py-2 text-sm font-semibold disabled:opacity-50">
              {running ? 'Working — results appear below' : 'Compare'}
            </button>
          </form>

          {(running || result) && (
            <div className="grid md:grid-cols-2 gap-4">
              {(['before', 'after'] as const).map((k) => (
                <div key={k} className="bg-[#0c1424] rounded-xl border border-white/10 overflow-hidden">
                  <p className="px-4 pt-3 text-sm font-semibold capitalize">{k}
                    <span className="text-white/50 font-normal"> {result?.actual_granule_dates?.[k] ?? ''}</span>
                  </p>
                  <div className="m-3 h-56 rounded-lg bg-black/40 border border-white/10 flex items-center justify-center overflow-hidden">
                    {previews[k] ? <img src={previews[k]} alt={`${k} preview`} className="w-full h-full object-cover" />
                      : running ? <p className="text-white/40 text-sm">Preview arrives with the result…</p>
                      : <p className="text-white/40 text-sm text-center px-4">No browse preview published<br />for this granule</p>}
                  </div>
                </div>
              ))}
            </div>
          )}
          {running && (
            <Card title="Analysis in progress">
              <p className="capitalize">{stage || 'starting'}… {mmss} elapsed{jobId ? ` · job ${jobId}` : ''}</p>
              <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                <div className="h-full bg-cyan-500 transition-all" style={{ width: `${progress}%` }} />
              </div>
            </Card>
          )}
          {error && <Card title="Analysis could not complete"><p className="text-red-300">{error}</p></Card>}
          {detail && result && <AnalysisResult result={result} />}
        </div>

        <div className="space-y-4">
          <section className="bg-[#0c1424] rounded-xl border border-white/10 p-5">
            <h2 className="font-semibold mb-3">Analysis Results</h2>
            {!result && <p className="text-sm text-white/50">Run a comparison — live values will appear here.</p>}
            {result && a && (
              <div className="space-y-3 text-sm">
                <div><p className="text-white/50 text-xs">Affected Area</p>
                  <p className="text-xl font-bold">{result.analysis.affected_area_km2 != null ? `${result.analysis.affected_area_km2.toFixed(2)} km²` : 'n/a'}</p>
                  <p className="text-[11px] text-white/40">{result.analysis.area_basis}</p></div>
                <div><p className="text-white/50 text-xs">Change Type</p><p className="font-semibold">{result.hazard_label}</p></div>
                <div><p className="text-white/50 text-xs">Quality</p><p className="font-semibold text-amber-200">Indicator — field validation needed</p></div>
                <div><p className="text-white/50 text-xs">Mean Backscatter Change</p><p className="font-semibold">{fmt(a.mean_backscatter_difference_db)} dB</p></div>
                <button onClick={() => setDetail((d) => !d)} className="w-full bg-blue-600 hover:bg-blue-500 rounded-lg px-4 py-2 text-sm font-semibold">
                  {detail ? 'Hide Detailed Report' : 'View Detailed Report'}
                </button>
              </div>
            )}
          </section>
          <Card title="How to read this">
            <p>dB drop beyond −2 dB → possible standing water. Strong change either way → fresh deposits, debris or canopy damage. Always check granule dates vs the event date.</p>
          </Card>
        </div>
      </div>
    </div>
  )
}

/* ---------------- 4. Event Monitoring ---------------- */

function Events() {
  const jobs = useJobs()
  const done = jobs.filter((j) => j.status === 'complete' && j.mean_db !== undefined)
  const [tab, setTab] = useState('all')
  const counts: Record<string, number> = { all: done.length }
  for (const h of HAZARDS) counts[h.id] = done.filter((j) => j.hazard === h.id).length
  const list = (tab === 'all' ? done : done.filter((j) => j.hazard === tab))
    .slice().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Event Monitoring</h1>
      <div className="flex flex-wrap gap-2">
        {[{ id: 'all', label: 'All Events' }, ...HAZARDS.map((h) => ({ id: h.id, label: h.label }))].map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`text-sm rounded-full px-4 py-1.5 ${tab === t.id ? 'bg-blue-600 text-white' : 'bg-white/5 text-white/65 hover:bg-white/10'}`}>
            {t.label} ({counts[t.id] ?? 0})
          </button>
        ))}
      </div>
      <div className="grid lg:grid-cols-3 gap-4">
        <div className="space-y-2">
          {list.length === 0 && <Card title="No events"><p>No completed analyses{tab !== 'all' ? ` for ${hazardLabel(tab)}` : ''} yet. Run one from Change Analysis.</p></Card>}
          {list.map((j) => (
            <div key={j.job_id} className="flex items-center gap-3 bg-[#0c1424] border border-white/10 rounded-xl p-3">
              <span className="w-10 h-10 rounded-lg shrink-0 flex items-center justify-center text-white font-bold"
                style={{ background: `${hazardColor(j.hazard)}33`, color: hazardColor(j.hazard) }}>
                {hazardLabel(j.hazard)[0]}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-white truncate">{hazardLabel(j.hazard)} — {regionName(j.location.lat, j.location.lon)}</p>
                <p className="text-xs text-white/45">{j.created_at ? timeAgo(j.created_at) : ''} · {fmt(j.mean_db)} dB</p>
              </div>
              <SevBadge level={severityOf(j)} />
            </div>
          ))}
        </div>
        <div className="lg:col-span-2 h-[480px] rounded-xl overflow-hidden border border-white/10">
          <MapContainer center={[20, 20]} zoom={2} style={{ height: '100%', width: '100%' }}>
            <TileLayer attribution="Esri World Imagery" url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" />
            {list.map((j) => (
              <CircleMarker key={j.job_id} center={[j.location.lat, j.location.lon]} radius={10}
                pathOptions={{ color: hazardColor(j.hazard), fillColor: hazardColor(j.hazard), fillOpacity: 0.6 }}>
                <Popup>{hazardLabel(j.hazard)} — {regionName(j.location.lat, j.location.lon)}<br />{fmt(j.mean_db)} dB · {j.created_at?.slice(0, 10)}</Popup>
              </CircleMarker>
            ))}
          </MapContainer>
        </div>
      </div>
      <div className="flex flex-wrap gap-3 text-xs text-white/60">
        {HAZARDS.map((h) => <span key={h.id} className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ background: h.color }} />{h.label}</span>)}
      </div>
    </div>
  )
}

/* ---------------- 5. Data Catalog ---------------- */

function Catalog() {
  const [tab, setTab] = useState('all')
  const [region, setRegion] = useState('amazon')
  const [start, setStart] = useState('2026-08-01')
  const [end, setEnd] = useState('2026-10-14')
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const search = async () => {
    const r = REGIONS.find((x) => x.id === region) ?? REGIONS[0]
    setLoading(true); setErr(null); setRows([])
    try {
      const q = new URLSearchParams({ dataset_id: 'nisar_l2_gcov', lat: String(r.lat), lon: String(r.lon), start_date: start, end_date: end })
      const res = await fetch(`${API_BASE}/observations?${q}`)
      const j = await res.json()
      if (!res.ok) throw new Error(j.detail ?? 'search failed')
      setRows(j)
    } catch (e: any) { setErr(e.message ?? 'search failed') }
    finally { setLoading(false) }
  }
  useEffect(() => { search() }, [])

  const levelOf = (sn: string) => (sn.includes('GCOV') ? 'L2' : sn.includes('RSLC') ? 'L1' : '—')

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Data Catalog</h1>
      <div className="flex flex-wrap gap-2">
        {[
          { id: 'all', label: 'All Products' }, { id: 'lband', label: 'L-band (NASA)' },
          { id: 'sband', label: 'S-band (ISRO)' }, { id: 'insar', label: 'InSAR' },
          { id: 'surface', label: 'Surface Change' },
        ].map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`text-sm rounded-full px-4 py-1.5 ${tab === t.id ? 'bg-blue-600 text-white' : 'bg-white/5 text-white/65 hover:bg-white/10'}`}>{t.label}</button>
        ))}
      </div>
      {(tab === 'sband' || tab === 'insar') ? (
        <Card title={tab === 'sband' ? 'S-band (ISRO Bhoonidhi)' : 'InSAR products'}>
          <p>{tab === 'sband'
            ? 'NISAR S-band data is served by ISRO through the Bhoonidhi portal — this catalog only queries the NASA L-band archive, so no rows are shown rather than invented ones.'
            : 'Interferometric deformation products need RSLC / InSAR processing, which TerraPulse does not stream yet. The catalog lists the GCOV backscatter products actually used.'}</p>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap gap-2 items-end bg-[#0c1424] border border-white/10 rounded-xl p-4">
            <label className="text-xs">Region <select value={region} onChange={(e) => setRegion(e.target.value)} className="ml-1 bg-white/10 rounded px-2 py-1.5">
              {REGIONS.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select></label>
            <label className="text-xs">From <input value={start} onChange={(e) => setStart(e.target.value)} className="ml-1 w-28 bg-white/10 rounded px-2 py-1.5" /></label>
            <label className="text-xs">To <input value={end} onChange={(e) => setEnd(e.target.value)} className="ml-1 w-28 bg-white/10 rounded px-2 py-1.5" /></label>
            <button onClick={search} disabled={loading} className="text-sm bg-blue-600 hover:bg-blue-500 rounded-lg px-4 py-1.5 font-medium disabled:opacity-50">
              {loading ? 'Searching live catalog…' : 'Search'}
            </button>
          </div>
          {err && <p className="text-red-300 text-sm">{err}</p>}
          {!err && !loading && rows.length === 0 && <Card title="No products"><p>No live granules match — widen the dates or pick another region.</p></Card>}
          {rows.length > 0 && (
            <div className="bg-[#0c1424] border border-white/10 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-white/50 text-xs border-b border-white/10">
                  <th className="p-3">Product</th><th className="p-3">Band</th><th className="p-3">Level</th>
                  <th className="p-3">Acquired</th><th className="p-3">Actions</th>
                </tr></thead>
                <tbody>
                  {rows.map((g: any) => (
                    <tr key={g.id ?? g.title} className="border-b border-white/5">
                      <td className="p-3"><p className="text-white break-all">{(g.title ?? '').slice(0, 42)}…</p>
                        <p className="text-xs text-white/40">{g.short_name}</p></td>
                      <td className="p-3">L-band</td>
                      <td className="p-3">{levelOf(g.short_name ?? '')}</td>
                      <td className="p-3">{g.acquisition_date ?? '—'}</td>
                      <td className="p-3">{g.https_url && <a href={g.https_url} target="_blank" rel="noreferrer" className="text-cyan-300 underline text-xs">Download</a>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}

/* ---------------- 6. Reports & Insights ---------------- */

function downloadFile(name: string, text: string, type: string) {
  const blob = new Blob([text], { type })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob); a.download = name; a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 5000)
}

function Reports() {
  const jobs = useJobs()
  const done = jobs.filter((j) => j.status === 'complete' && j.mean_db !== undefined)
    .slice().sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
  const [tab, setTab] = useState('overview')
  const [region, setRegion] = useState('all')

  const filtered = region === 'all' ? done : done.filter((j) => regionName(j.location.lat, j.location.lon) === REGIONS.find((r) => r.id === region)?.name)
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
    const lines = filtered.map((j) => [j.job_id, j.hazard, j.location.lat, j.location.lon,
      j.actual_granule_dates?.before ?? '', j.actual_granule_dates?.after ?? '',
      j.mean_db ?? '', j.percentage_decrease ?? '', j.percentage_disturbed ?? '',
      j.affected_area_km2 ?? '', j.outlines ?? '', j.created_at ?? ''].join(','))
    downloadFile('terrapulse-report.csv', [head, ...lines].join('\n'), 'text/csv')
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold">Reports &amp; Insights</h1>
        <div className="ml-auto flex gap-2">
          {['overview', 'trends', 'regional'].map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`text-sm rounded-lg px-3 py-1.5 capitalize ${tab === t ? 'bg-blue-600' : 'bg-white/5 text-white/65'}`}>{t === 'regional' ? 'Regional Insights' : t}</button>
          ))}
          <button onClick={() => window.print()} className="text-sm border border-white/15 rounded-lg px-3 py-1.5">Download Report</button>
        </div>
      </div>
      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <Card title="Surface Change Trend">
            {trend.length === 0 && <p>No completed analyses yet — the trend builds from real results.</p>}
            {trend.length > 0 && (
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={trend}>
                    <CartesianGrid stroke="rgba(255,255,255,0.08)" />
                    <XAxis dataKey="t" tick={{ fontSize: 11, fill: '#94a3b8' }} />
                    <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} />
                    <Tooltip contentStyle={{ background: '#0c1424', border: '1px solid rgba(255,255,255,0.15)' }} />
                    <Legend />
                    <Area type="monotone" dataKey="meanDb" name="Mean Δ (dB)" stroke="#38b6ff" fill="#38b6ff33" />
                    <Area type="monotone" dataKey="changed" name="Changed %" stroke="#22c55e" fill="#22c55e33" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>
          <Card title="Key Insights">
            {insights.length === 0 && <p>Insights are generated from completed live analyses — none yet.</p>}
            <ul className="list-disc pl-5 space-y-1">{insights.map((s, i) => <li key={i}>{s}</li>)}</ul>
          </Card>
        </div>
        <Card title="Generate Report">
          <label className="text-xs">Region <select value={region} onChange={(e) => setRegion(e.target.value)} className="mt-1 w-full bg-white/10 rounded px-2 py-1.5">
            <option value="all">All regions</option>
            {REGIONS.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select></label>
          <p className="text-xs pt-2">{filtered.length} completed analyses in scope.</p>
          <button onClick={() => window.print()} className="w-full bg-blue-600 hover:bg-blue-500 rounded-lg px-4 py-2 text-sm font-semibold">Generate PDF Report</button>
          <button onClick={csv} className="w-full border border-white/15 rounded-lg px-4 py-2 text-sm">Download CSV Data</button>
          <button onClick={() => downloadFile('terrapulse-report.json', JSON.stringify(filtered, null, 2), 'application/json')} className="w-full border border-white/15 rounded-lg px-4 py-2 text-sm">Download JSON</button>
        </Card>
      </div>
    </div>
  )
}

/* ---------------- 7. Alerts Center ---------------- */

function Alerts() {
  const jobs = useJobs()
  const [tab, setTab] = useState('all')
  const [open, setOpen] = useState<string | null>(null)
  const [detail, setDetail] = useState<any>(null)
  const viewed = getViewed()

  const rows = jobs
    .filter((j) => j.status === 'complete' || j.status === 'running')
    .map((j) => ({
      job: j,
      sev: j.status === 'running' ? 'Monitoring' : severityOf(j),
      status: j.status === 'running' ? 'Monitoring' : viewed.includes(j.job_id) ? 'Analyzed' : 'New',
    }))
    .sort((a, b) => String(b.job.created_at).localeCompare(String(a.job.created_at)))
  const cnt = {
    all: rows.length,
    High: rows.filter((r) => r.sev === 'High').length,
    Medium: rows.filter((r) => r.sev === 'Medium').length,
    Low: rows.filter((r) => r.sev === 'Low').length,
  }
  const list = tab === 'all' ? rows : rows.filter((r) => r.sev === tab)

  const view = async (job_id: string) => {
    if (open === job_id) { setOpen(null); return }
    setOpen(job_id); setDetail(null)
    markViewed(job_id)
    try {
      const r = await fetch(`${API_BASE}/analysis/jobs/${job_id}`)
      const j = await r.json()
      setDetail(j.result)
    } catch { /* ignore */ }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Alerts Center</h1>
      <p className="text-xs text-white/45">Severity rule (transparent): ≥40% flagged pixels → High · ≥15% → Medium · else Low.</p>
      <div className="flex flex-wrap gap-2">
        {[['all', `All Alerts (${cnt.all})`], ['High', `High (${cnt.High})`], ['Medium', `Medium (${cnt.Medium})`], ['Low', `Low (${cnt.Low})`]].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`text-sm rounded-full px-4 py-1.5 ${tab === id ? 'bg-blue-600 text-white' : 'bg-white/5 text-white/65 hover:bg-white/10'}`}>{label}</button>
        ))}
      </div>
      {list.length === 0 && <Card title="No alerts"><p>Alerts are raised from completed live analyses — none yet.</p></Card>}
      {list.length > 0 && (
        <div className="bg-[#0c1424] border border-white/10 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-white/50 text-xs border-b border-white/10">
              <th className="p-3">Event</th><th className="p-3">Location</th><th className="p-3">Severity</th>
              <th className="p-3">Detected On</th><th className="p-3">Status</th><th className="p-3">Action</th>
            </tr></thead>
            <tbody>
              {list.map(({ job: j, sev, status }) => (
                <>
                  <tr key={j.job_id} className="border-b border-white/5">
                    <td className="p-3 text-white">{hazardLabel(j.hazard)} indicator</td>
                    <td className="p-3">{regionName(j.location.lat, j.location.lon)}</td>
                    <td className="p-3">{sev === 'Monitoring' ? <span className="text-xs text-cyan-300">Monitoring</span> : <SevBadge level={sev} />}</td>
                    <td className="p-3">{String(j.created_at ?? '').slice(0, 10)}</td>
                    <td className="p-3 text-white/60">{status}</td>
                    <td className="p-3"><button onClick={() => view(j.job_id)} className="text-xs bg-blue-600 rounded px-3 py-1">View</button></td>
                  </tr>
                  {open === j.job_id && (
                    <tr key={j.job_id + '-d'}><td colSpan={6} className="p-3 bg-black/30">
                      {detail ? <AnalysisResult result={detail} /> : <p className="text-white/50 text-sm">Loading result…</p>}
                    </td></tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/* ---------------- 8. Settings & Data Sources ---------------- */

function Settings() {
  const [tab, setTab] = useState('sources')
  const [auth, setAuth] = useState<any>(null)
  const [testing, setTesting] = useState(false)
  const [prefs, setPrefs] = useState(getPrefs())

  const testConnection = async () => {
    setTesting(true)
    try {
      const r = await fetch(`${API_BASE}/auth/status`)
      setAuth(await r.json())
    } catch { setAuth({ connected: false, timestamp: new Date().toISOString(), note: 'Backend unreachable.' }) }
    finally { setTesting(false) }
  }
  useEffect(() => { testConnection() }, [])

  const savePrefs = (p: any) => {
    setPrefs(p)
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)) } catch { /* ignore */ }
  }

  return (
    <div className="space-y-4 max-w-5xl">
      <h1 className="text-2xl font-bold">Settings &amp; Data Sources</h1>
      <div className="flex gap-2">
        {[['sources', 'Data Sources'], ['processing', 'Processing'], ['account', 'Account'], ['preferences', 'Preferences']].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`text-sm rounded-lg px-4 py-1.5 ${tab === id ? 'bg-blue-600 text-white' : 'bg-white/5 text-white/65'}`}>{label}</button>
        ))}
      </div>
      {tab === 'sources' && (
        <div className="grid md:grid-cols-2 gap-4">
          <Card title="NASA Earthdata (ASF DAAC)">
            <p>L-band NISAR data through NASA Earthdata.</p>
            <p className="text-xs">Status check: {auth ? (auth.connected ? 'Connected' : 'Failed') : '…'}
              {auth?.timestamp ? ` · ${auth.timestamp.slice(0, 19).replace('T', ' ')} UTC` : ''}</p>
            {auth && !auth.connected && <p className="text-amber-200 text-xs">{auth.note}</p>}
            <button onClick={testConnection} disabled={testing} className="text-sm border border-cyan-500/50 text-cyan-300 rounded-lg px-3 py-1.5 disabled:opacity-50">
              {testing ? 'Testing…' : 'Test Connection'}
            </button>
          </Card>
          <Card title="ISRO Bhoonidhi (S-band)">
            <p>S-band NISAR data is served by ISRO through Bhoonidhi — not integrated in this build.</p>
            <p className="text-xs text-white/50">Status: not configured (L-band only).</p>
          </Card>
        </div>
      )}
      {tab === 'processing' && (
        <Card title="Processing Settings">
          <label className="flex items-center justify-between gap-4">Auto-dates by default (newest pair)
            <input type="checkbox" checked={prefs.autoDates !== false} onChange={(e) => savePrefs({ ...prefs, autoDates: e.target.checked })} /></label>
          <label className="flex items-center justify-between gap-4">Default hazard
            <select value={prefs.defaultHazard} onChange={(e) => savePrefs({ ...prefs, defaultHazard: e.target.value })} className="bg-white/10 rounded px-2 py-1">
              {HAZARDS.map((h) => <option key={h.id} value={h.id}>{h.label}</option>)}
            </select></label>
          <p className="text-xs text-white/45">Saved in this browser and applied across pages.</p>
        </Card>
      )}
      {tab === 'account' && (
        <Card title="Account">
          <p>Earthdata credentials live only in <span className="text-white">backend/.env</span> on this machine — never in the app or git.</p>
          <p className="text-xs">Configured: {auth ? (auth.connected ? 'yes (verified just now)' : 'no / invalid — see note above') : 'checking…'}</p>
        </Card>
      )}
      {tab === 'preferences' && (
        <Card title="Map Preferences">
          <label className="flex items-center justify-between gap-4">Default region
            <select value={prefs.defaultRegion} onChange={(e) => savePrefs({ ...prefs, defaultRegion: e.target.value })} className="bg-white/10 rounded px-2 py-1">
              {REGIONS.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select></label>
          <label className="flex items-center justify-between gap-4">Default base layer
            <select value={prefs.baseLayer} onChange={(e) => savePrefs({ ...prefs, baseLayer: e.target.value })} className="bg-white/10 rounded px-2 py-1">
              <option value="esri">Satellite</option>
              <option value="osm">Streets</option>
            </select></label>
        </Card>
      )}
    </div>
  )
}

/* ---------------- shell ---------------- */

const NAV = [
  { path: '/', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/explore', label: 'Explore Map', icon: MapIcon },
  { path: '/change', label: 'Change Analysis', icon: FlaskConical },
  { path: '/events', label: 'Event Monitoring', icon: Activity },
  { path: '/catalog', label: 'Data Catalog', icon: Database },
  { path: '/reports', label: 'Reports', icon: FileText },
  { path: '/alerts', label: 'Alerts', icon: Bell },
  { path: '/settings', label: 'Settings', icon: SettingsIcon },
]

function Layout() {
  const ok = useBackendStatus()
  const [q, setQ] = useState('')
  const navigate = useNavigate()
  const searchAll = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!q.trim()) return
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(q)}&limit=1`)
      const j = await r.json()
      if (j?.[0]) navigate(`/explore?lat=${j[0].lat}&lon=${j[0].lon}&label=${encodeURIComponent(j[0].display_name.split(',').slice(0, 2).join(','))}`)
    } catch { /* ignore */ }
  }
  return (
    <div className="min-h-screen bg-[#060b16] text-white flex flex-col">
      <div className="flex flex-1 min-h-0">
        <aside className="w-60 shrink-0 border-r border-white/10 bg-[#0a1120] p-4 flex flex-col gap-1">
          <div className="flex items-center gap-2 px-2 pb-4">
            <Satellite size={20} className="text-cyan-400" />
            <span className="font-bold tracking-wide">NISAR</span>
          </div>
          {NAV.map((l) => (
            <NavLink key={l.path} to={l.path}
              className={({ isActive }) => `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${isActive ? 'bg-blue-600 text-white' : 'text-white/60 hover:text-white hover:bg-white/5'}`}>
              <l.icon size={16} />{l.label}
            </NavLink>
          ))}
          <p className="mt-auto text-[11px] text-white/35 px-3 pt-3">Live NISAR data · no mock data</p>
        </aside>
        <div className="flex-1 min-w-0 flex flex-col">
          <header className="flex items-center gap-3 px-6 py-3 border-b border-white/10">
            <form onSubmit={searchAll} className="flex items-center gap-2 bg-[#0c1424] border border-white/10 rounded-lg px-3 py-1.5 w-80">
              <Search size={14} className="text-white/40" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search location, region…"
                className="bg-transparent outline-none text-sm w-full" />
            </form>
            <div className="ml-auto flex items-center gap-3">
              <span className={`w-2 h-2 rounded-full ${ok === null ? 'bg-amber-400' : ok ? 'bg-emerald-400' : 'bg-red-400'}`} title={ok ? 'Backend connected' : 'Backend unreachable'} />
              <button onClick={() => navigate('/alerts')} title="Alerts"><Bell size={17} className="text-white/70" /></button>
              <span className="w-7 h-7 rounded-full bg-white/15 flex items-center justify-center text-xs font-bold">R</span>
            </div>
          </header>
          <main className="flex-1 p-6 min-w-0 overflow-y-auto">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/explore" element={<ExploreMap />} />
              <Route path="/change" element={<ChangeAnalysis />} />
              <Route path="/change-detection" element={<ChangeAnalysis />} />
              <Route path="/events" element={<Events />} />
              <Route path="/catalog" element={<Catalog />} />
              <Route path="/data-explorer" element={<Catalog />} />
              <Route path="/reports" element={<Reports />} />
              <Route path="/alerts" element={<Alerts />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/methodology" element={<Reports />} />
              <Route path="/about" element={<Settings />} />
              <Route path="/locations" element={<Events />} />
            </Routes>
          </main>
        </div>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Layout />
    </BrowserRouter>
  )
}

// Re-exported for alerts detail rows (kept local to avoid extra files)
export function InfoNote({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-white/50 flex gap-1.5"><Info size={13} className="shrink-0 mt-0.5" />{children}</p>
}
export function MapLinkNote() {
  return <span className="inline-flex items-center gap-1 text-xs text-white/50"><MapPin size={12} /> coordinates are WGS84</span>
}
