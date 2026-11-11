import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { fetchPointInsights, startHazardJob } from '../api/analysis'
import { geocodePlace } from '../api/geocode'
import { AnalysisResult } from '../components/AnalysisResult'
import { Card } from '../components/Card'
import { HazardPicker } from '../components/HazardPicker'
import { SevBadge } from '../components/SevBadge'
import { Skeleton } from '../components/Skeleton'
import { useJobPolling } from '../hooks/useJobPolling'
import { usePrefsStore } from '../store/usePrefsStore'
import { formatArea, formatPower } from '../utils/format'
import { HAZARDS } from '../utils/geo'

const DEFAULT_BEFORE_DATE = '2026-08-10'

function parseBboxParam(raw: string | null): number[] | null {
  if (!raw) return null
  const nums = raw.split(',').map((s) => Number.parseFloat(s.trim()))
  if (nums.length !== 4 || nums.some((n) => !Number.isFinite(n))) return null
  return nums
}

export default function ChangeAnalysis() {
  const [params] = useSearchParams()
  const prefs = usePrefsStore((s) => s.prefs)
  const storedLastResult = usePrefsStore((s) => s.lastResult)
  const setLastResult = usePrefsStore((s) => s.setLastResult)
  const activeJobId = usePrefsStore((s) => s.activeJobId)
  const activeJobStartedAt = usePrefsStore((s) => s.activeJobStartedAt)
  const setActiveJob = usePrefsStore((s) => s.setActiveJob)

  const [form, setForm] = useState(() => ({
    place: '',
    before: params.get('before') ?? DEFAULT_BEFORE_DATE,
    after: params.get('after') ?? '',
    lat: params.get('lat') ?? '26.2',
    lon: params.get('lon') ?? '92.9',
  }))
  const [hazard, setHazard] = useState(() => {
    const hz = params.get('hazard')
    return hz && HAZARDS.some((h) => h.id === hz) ? hz : (prefs.defaultHazard ?? 'flood')
  })
  const [auto, setAuto] = useState(() => params.get('auto') === '1')
  const [afterLatest, setAfterLatest] = useState(() => {
    if (params.get('auto') === '1') return false
    return !params.get('after')
  })
  const [band, setBand] = useState(() => HAZARDS.find((h) => h.id === hazard)?.defaultBand ?? 'HH')
  const [speckleFilter, setSpeckleFilter] = useState('lee')
  const [thresholdMode, setThresholdMode] = useState('fixed')
  const [windowSize, setWindowSize] = useState(256)
  const [waterMask, setWaterMask] = useState(false)
  const [slopeMask, setSlopeMask] = useState(false)
  const [bbox, setBbox] = useState<number[] | null>(() => parseBboxParam(params.get('bbox')))

  const [nowMs, setNowMs] = useState(() => Date.now())
  const [validationError, setValidationError] = useState<string | null>(null)
  const [detail, setDetail] = useState(true)

  const paramStr = params.toString()
  const [lastSyncedParams, setLastSyncedParams] = useState(paramStr)
  if (paramStr && paramStr !== lastSyncedParams) {
    setLastSyncedParams(paramStr)
    const p = new URLSearchParams(paramStr)
    const pLat = p.get('lat')
    const pLon = p.get('lon')
    const pBefore = p.get('before')
    const pAfter = p.get('after')
    const pHz = p.get('hazard')
    const pAuto = p.get('auto')
    setForm((prev) => ({
      ...prev,
      lat: pLat ?? prev.lat,
      lon: pLon ?? prev.lon,
      before: pBefore ?? prev.before,
      after: pAfter ?? (pAuto === '1' ? prev.after : ''),
    }))
    if (pAuto === '1') {
      setAuto(true)
      setAfterLatest(false)
    } else if (pBefore && pAfter) {
      setAuto(false)
      setAfterLatest(false)
    } else if (pBefore && !pAfter) {
      setAuto(false)
      setAfterLatest(true)
    }
    if (pHz && HAZARDS.some((h) => h.id === pHz)) setHazard(pHz)
    setBbox(parseBboxParam(p.get('bbox')))
  }

  const parsedLat = Number.parseFloat(form.lat)
  const parsedLon = Number.parseFloat(form.lon)
  const validCoords =
    Number.isFinite(parsedLat) &&
    Number.isFinite(parsedLon) &&
    parsedLat >= -90 &&
    parsedLat <= 90 &&
    parsedLon >= -180 &&
    parsedLon <= 180

  const passesQuery = useQuery({
    queryKey: ['point-insights', Math.round(parsedLat * 100) / 100, Math.round(parsedLon * 100) / 100],
    queryFn: () => fetchPointInsights(parsedLat, parsedLon),
    enabled: validCoords,
    staleTime: 180000,
    retry: 0,
  })

  const jobQuery = useJobPolling(activeJobId)
  const running =
    Boolean(activeJobId) &&
    jobQuery.data?.status !== 'complete' &&
    jobQuery.data?.status !== 'completed' &&
    jobQuery.data?.status !== 'failed' &&
    !jobQuery.isError

  useEffect(() => {
    if (!running || activeJobStartedAt === null) return
    const timer = window.setInterval(() => {
      setNowMs(Date.now())
    }, 1000)
    return () => window.clearInterval(timer)
  }, [running, activeJobStartedAt])

  const elapsed =
    running && activeJobStartedAt !== null
      ? Math.max(0, Math.floor((nowMs - activeJobStartedAt) / 1000))
      : 0

  useEffect(() => {
    if ((jobQuery.data?.status === 'complete' || jobQuery.data?.status === 'completed') && jobQuery.data.result) {
      setLastResult(jobQuery.data.result)
    }
  }, [jobQuery.data, setLastResult])

  const startMutation = useMutation({
    mutationFn: startHazardJob,
    onSuccess: (res) => {
      const ts = Date.now()
      setNowMs(ts)
      setActiveJob(res.job_id, ts)
      toast.info(`Started ${res.hazard ?? hazard} job ${res.job_id}`)
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const onSelectHazard = (nextHz: string) => {
    setHazard(nextHz)
    const meta = HAZARDS.find((h) => h.id === nextHz)
    if (meta?.defaultBand) setBand(meta.defaultBand)
  }

  const lookupPlace = async () => {
    if (!form.place.trim()) return
    try {
      const results = await geocodePlace(form.place, 1)
      if (results[0]) {
        setForm((f) => ({
          ...f,
          lat: String(+Number.parseFloat(results[0].lat).toFixed(3)),
          lon: String(+Number.parseFloat(results[0].lon).toFixed(3)),
        }))
        setValidationError(null)
      } else {
        setValidationError(`No place found for “${form.place}”. Try coordinates instead.`)
      }
    } catch {
      setValidationError('Place search unreachable — enter coordinates directly.')
    }
  }

  const run = (e: FormEvent) => {
    e.preventDefault()
    const lat = Number.parseFloat(form.lat)
    const lon = Number.parseFloat(form.lon)
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lon) || lon < -180 || lon > 180) {
      setValidationError('Latitude must be −90…90, longitude −180…180.')
      return
    }
    if (!auto) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(form.before)) {
        setValidationError('Before date must be YYYY-MM-DD (or tick auto-pick both dates).')
        return
      }
      if (!afterLatest) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(form.after)) {
          setValidationError('After date must be YYYY-MM-DD (or select After = latest available pass).')
          return
        }
        if (new Date(form.after) <= new Date(form.before)) {
          setValidationError('After date must be after before date.')
          return
        }
        if ((new Date(form.after).getTime() - new Date(form.before).getTime()) / 86400000 < 12) {
          setValidationError('Use dates at least 12 days apart (NISAR revisit cycle).')
          return
        }
      }
    }
    setValidationError(null)
    setActiveJob(null)
    startMutation.mutate({
      hazard,
      lat,
      lon,
      beforeDate: auto ? undefined : form.before,
      afterDate: auto ? undefined : afterLatest ? 'latest' : form.after,
      datasetId: hazard === 'deformation' ? 'nisar_l2_gunw' : 'nisar_l2_gcov',
      band,
      window: windowSize,
      bbox,
      speckleFilter,
      thresholdMode,
      waterMask,
      slopeMask,
    })
  }

  const result = jobQuery.data?.result ?? (running ? null : storedLastResult)
  const errorMessage =
    validationError ??
    (startMutation.error instanceof Error ? startMutation.error.message : null) ??
    (jobQuery.data?.status === 'failed' ? (jobQuery.data.error ?? 'Analysis failed') : null) ??
    (jobQuery.isError ? `Lost contact with backend: ${jobQuery.error.message}` : null)

  const mmss = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`
  const a = result?.analysis
  const shownJobId = activeJobId ?? jobQuery.data?.job_id ?? null

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Change Analysis</h1>
          <p className="text-xs text-white/55">
            Live NASA-ISRO NISAR Before vs After radar comparison — no mock or sample results.
          </p>
        </div>
        <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-200">
          Real NASA Earthdata Only
        </span>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <form onSubmit={run} className="bg-[#0c1424] p-5 rounded-xl border border-white/10 space-y-3">
            <HazardPicker value={hazard} onChange={onSelectHazard} />
            {bbox && (
              <div className="flex items-center justify-between gap-2 rounded-lg bg-cyan-500/10 border border-cyan-500/30 px-3 py-1.5 text-xs text-cyan-200">
                <span>AOI crop active: [{bbox.map((v) => v.toFixed(3)).join(', ')}]</span>
                <button type="button" onClick={() => setBbox(null)} className="underline">
                  Clear AOI
                </button>
              </div>
            )}
            <div className="grid md:grid-cols-3 gap-3">
              <label className="text-sm md:col-span-1">
                Location
                <span className="flex gap-1 mt-1">
                  <input
                    value={form.place}
                    onChange={(e) => setForm({ ...form, place: e.target.value })}
                    placeholder="Assam, India"
                    className="w-full bg-white/10 rounded px-2 py-1.5"
                  />
                  <button
                    type="button"
                    onClick={lookupPlace}
                    className="bg-white/10 rounded px-2"
                    title="Find coordinates"
                    aria-label="Find place coordinates"
                  >
                    <Search size={14} />
                  </button>
                </span>
                <span className="text-xs text-white/50">
                  {form.lat}, {form.lon}
                </span>
              </label>
              <label className="text-sm">
                Before {auto && <span className="text-[11px] text-white/45">(auto on)</span>}
                <input
                  value={form.before}
                  onChange={(e) => {
                    setForm({ ...form, before: e.target.value })
                    if (auto) setAuto(false)
                  }}
                  placeholder={DEFAULT_BEFORE_DATE}
                  className="mt-1 w-full bg-white/10 rounded px-2 py-1.5 text-white"
                />
              </label>
              <label className="text-sm">
                After{' '}
                {afterLatest ? (
                  <span className="text-[11px] text-cyan-300">(latest pass auto)</span>
                ) : auto ? (
                  <span className="text-[11px] text-white/45">(auto on)</span>
                ) : null}
                <input
                  value={afterLatest ? 'Latest available pass (auto)' : form.after}
                  disabled={afterLatest}
                  onChange={(e) => {
                    setForm({ ...form, after: e.target.value })
                    setAfterLatest(false)
                    if (auto) setAuto(false)
                  }}
                  placeholder="YYYY-MM-DD"
                  className="mt-1 w-full bg-white/10 rounded px-2 py-1.5 text-white disabled:opacity-60"
                />
              </label>
            </div>
            {passesQuery.data?.available && (passesQuery.data.available_passes?.length ?? 0) > 0 && (
              <div className="rounded-lg bg-white/5 border border-white/10 p-2.5 text-xs space-y-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-white/75">
                    Real NASA CMR passes near ({parsedLat.toFixed(2)}, {parsedLon.toFixed(2)}):{' '}
                    <strong className="text-cyan-300">
                      {passesQuery.data.earliest_acquisition} → {passesQuery.data.latest_acquisition}
                    </strong>{' '}
                    ({passesQuery.data.available_passes!.length} dates)
                  </span>
                  {passesQuery.data.available_passes!.length >= 2 && (
                    <button
                      type="button"
                      onClick={() => {
                        const ps = passesQuery.data!.available_passes!
                        const newest = ps[0].date
                        const oldest = ps[ps.length - 1].date
                        setForm((prev) => ({ ...prev, before: oldest, after: newest }))
                        setAfterLatest(false)
                        setAuto(false)
                      }}
                      className="rounded bg-cyan-600/80 hover:bg-cyan-500 px-2 py-0.5 text-[11px] font-medium text-white"
                    >
                      Use earliest ({passesQuery.data.earliest_acquisition}) → latest ({passesQuery.data.latest_acquisition})
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5 items-center">
                  <span className="text-[11px] text-white/50">Click pass to set After:</span>
                  {passesQuery.data.available_passes!.slice(0, 8).map((p) => (
                    <button
                      type="button"
                      key={`chip-${p.date}-${p.orbit_direction}`}
                      onClick={() => {
                        setForm((prev) => ({ ...prev, after: p.date }))
                        setAfterLatest(false)
                        setAuto(false)
                      }}
                      className={`rounded px-2 py-0.5 text-[11px] ${
                        !auto && !afterLatest && form.after === p.date
                          ? 'bg-blue-600 text-white'
                          : 'bg-white/10 text-white/75 hover:bg-white/20'
                      }`}
                    >
                      {p.date} ({(p.orbit_direction ?? '?').slice(0, 1).toUpperCase()})
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <label className="text-xs text-white/70">
                Latitude
                <input
                  value={form.lat}
                  onChange={(e) => setForm({ ...form, lat: e.target.value })}
                  className="mt-1 w-full bg-white/10 rounded px-2 py-1.5 text-sm text-white"
                />
              </label>
              <label className="text-xs text-white/70">
                Longitude
                <input
                  value={form.lon}
                  onChange={(e) => setForm({ ...form, lon: e.target.value })}
                  className="mt-1 w-full bg-white/10 rounded px-2 py-1.5 text-sm text-white"
                />
              </label>
              <label className="text-xs text-white/70">
                Band
                <select
                  value={band}
                  onChange={(e) => setBand(e.target.value)}
                  className="mt-1 w-full bg-[#060b16] border border-white/15 rounded px-2 py-1.5 text-sm text-white"
                >
                  <option value="HH">HH</option>
                  <option value="HV">HV</option>
                  <option value="VV">VV</option>
                  <option value="HH/HV">HH/HV ratio</option>
                </select>
              </label>
              <label className="text-xs text-white/70">
                Window (px)
                <select
                  value={windowSize}
                  onChange={(e) => setWindowSize(Number(e.target.value))}
                  className="mt-1 w-full bg-[#060b16] border border-white/15 rounded px-2 py-1.5 text-sm text-white"
                >
                  <option value={128}>128 × 128</option>
                  <option value={256}>256 × 256</option>
                  <option value={512}>512 × 512</option>
                </select>
              </label>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-1">
              <label className="text-xs text-white/70">
                Speckle filter
                <select
                  value={speckleFilter}
                  onChange={(e) => setSpeckleFilter(e.target.value)}
                  className="mt-1 w-full bg-[#060b16] border border-white/15 rounded px-2 py-1.5 text-sm text-white"
                >
                  <option value="none">None (raw)</option>
                  <option value="boxcar">Boxcar (5×5)</option>
                  <option value="lee">Lee Adaptive (5×5)</option>
                </select>
              </label>
              <label className="text-xs text-white/70">
                Threshold
                <select
                  value={thresholdMode}
                  onChange={(e) => setThresholdMode(e.target.value)}
                  className="mt-1 w-full bg-[#060b16] border border-white/15 rounded px-2 py-1.5 text-sm text-white"
                >
                  <option value="fixed">Fixed (−2.0 dB / ±2 dB)</option>
                  <option value="otsu">Adaptive Otsu</option>
                  <option value="mean_std">Mean ± 1.5·Std</option>
                </select>
              </label>
              <label className="text-xs flex items-center gap-2 pt-4 text-white/80">
                <input
                  type="checkbox"
                  checked={waterMask}
                  onChange={(e) => setWaterMask(e.target.checked)}
                />
                Water mask check
              </label>
              <label className="text-xs flex items-center gap-2 pt-4 text-white/80">
                <input
                  type="checkbox"
                  checked={slopeMask}
                  onChange={(e) => setSlopeMask(e.target.checked)}
                />
                Terrain slope check
              </label>
            </div>
            <div className="flex flex-wrap gap-4 pt-1">
              <label className="text-sm flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={afterLatest}
                  onChange={(e) => {
                    const checked = e.target.checked
                    setAfterLatest(checked)
                    if (checked) setAuto(false)
                    else if (!form.after) {
                      setForm((prev) => ({
                        ...prev,
                        after: passesQuery.data?.latest_acquisition ?? '',
                      }))
                    }
                  }}
                />
                After = latest available pass (recommended)
              </label>
              <label className="text-sm flex items-center gap-2 text-white/75">
                <input
                  type="checkbox"
                  checked={auto}
                  onChange={(e) => {
                    const checked = e.target.checked
                    setAuto(checked)
                    if (checked) setAfterLatest(false)
                  }}
                />
                Auto-pick both dates (180d)
              </label>
            </div>
            <button
              type="submit"
              disabled={running || startMutation.isPending}
              className="w-full md:w-auto bg-blue-600 hover:bg-blue-500 rounded-lg px-8 py-2 text-sm font-semibold disabled:opacity-50"
            >
              {running || startMutation.isPending ? 'Working — results appear below' : 'Compare'}
            </button>
          </form>

          {running && (
            <div className="space-y-4">
              <Card title="Live NASA Earthdata Analysis in Progress">
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <p className="capitalize font-medium text-cyan-200">
                    Stage: {jobQuery.data?.stage || 'starting'}…
                  </p>
                  <p className="text-xs text-white/70">
                    {mmss} elapsed · {jobQuery.data?.progress ?? 5}% · job {activeJobId}
                  </p>
                </div>
                <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-cyan-500 transition-all"
                    style={{ width: `${jobQuery.data?.progress ?? 5}%` }}
                  />
                </div>
                <p className="text-[11px] text-white/55">
                  Streaming real NISAR HDF5 windows over HTTPS. You can navigate to other pages and
                  return — this job continues running and will resume automatically.
                </p>
              </Card>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 rounded-xl border border-white/10 bg-[#0c1424] p-4">
                {[
                  { title: `1. Before (${auto ? 'auto' : form.before})` },
                  { title: `2. After (${afterLatest || auto ? 'latest auto' : form.after})` },
                  { title: '3. Detected Change' },
                ].map((panel) => (
                  <div key={panel.title} className="space-y-2">
                    <p className="text-xs font-semibold text-white/75">{panel.title}</p>
                    <Skeleton className="aspect-square w-full rounded-lg" />
                  </div>
                ))}
              </div>

              <div className="rounded-xl border border-white/10 bg-[#0c1424] p-4 space-y-3">
                <Skeleton className="h-4 w-56" />
                <div className="grid grid-cols-3 gap-3">
                  <Skeleton className="h-14 w-full rounded-lg" />
                  <Skeleton className="h-14 w-full rounded-lg" />
                  <Skeleton className="h-14 w-full rounded-lg" />
                </div>
                <Skeleton className="h-44 w-full rounded-lg" />
              </div>
            </div>
          )}
          {errorMessage && (
            <Card title="Analysis could not complete">
              <p className="text-red-300">{errorMessage}</p>
            </Card>
          )}
          {detail && result && <AnalysisResult result={result} jobId={shownJobId} />}
        </div>

        <div className="space-y-4">
          <section className="bg-[#0c1424] rounded-xl border border-white/10 p-5">
            <h2 className="font-semibold mb-3">Analysis Results</h2>
            {!result && running && (
              <div className="space-y-3">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-8 w-40" />
                <Skeleton className="h-4 w-44" />
                <Skeleton className="h-4 w-36" />
              </div>
            )}
            {!result && !running && (
              <p className="text-sm text-white/50">
                Choose a point and click Compare to stream real NASA NISAR Before vs After passes.
              </p>
            )}
            {result && a && (
              <div className="space-y-3 text-sm">
                <div>
                  <p className="text-white/50 text-xs">Affected Area</p>
                  <p className="text-xl font-bold">{formatArea(a.affected_area_km2, prefs.areaUnit)}</p>
                  <p className="text-[11px] text-white/40">{a.area_basis}</p>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-white/50 text-xs">Change Type</p>
                    <p className="font-semibold">{result.hazard_label}</p>
                  </div>
                  {result.severity && <SevBadge level={result.severity} />}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <p className="text-white/50 text-xs">Mean Δ Backscatter</p>
                    <p className="font-semibold">{formatPower(a.mean_backscatter_difference_db, prefs.powerUnit)}</p>
                  </div>
                  <div>
                    <p className="text-white/50 text-xs">% Area Changed</p>
                    <p className="font-semibold">
                      {(a.percentage_disturbed ?? a.percentage_decrease ?? 0).toFixed(1)}%
                    </p>
                  </div>
                </div>
                {result.confidence?.level && (
                  <div>
                    <p className="text-white/50 text-xs">Confidence</p>
                    <p className="font-semibold text-cyan-200">
                      {result.confidence.level}
                      {typeof result.confidence.score === 'number'
                        ? ` (${Math.round(result.confidence.score * 100)}%)`
                        : ''}
                    </p>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => setDetail((d) => !d)}
                  className="w-full bg-blue-600 hover:bg-blue-500 rounded-lg px-4 py-2 text-sm font-semibold"
                >
                  {detail ? 'Hide Detailed Report' : 'View Detailed Report'}
                </button>
              </div>
            )}
          </section>
          <Card title="How to read this">
            <p>
              dB drop beyond −2 dB → possible standing water or canopy loss. Strong magnitude change → fresh
              lava, landslides or crop change. Use Lee filter to suppress speckle noise before thresholding.
            </p>
          </Card>
        </div>
      </div>
    </div>
  )
}
