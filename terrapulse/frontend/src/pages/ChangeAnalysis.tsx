import { useEffect, useState, type FormEvent } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { startHazardJob } from '../api/analysis'
import { geocodePlace } from '../api/geocode'
import { AnalysisResult } from '../components/AnalysisResult'
import { Card } from '../components/Card'
import { HazardPicker } from '../components/HazardPicker'
import { useJobPolling } from '../hooks/useJobPolling'
import { usePrefsStore } from '../store/usePrefsStore'
import { fmt } from '../utils/format'
import { HAZARDS } from '../utils/geo'

export default function ChangeAnalysis() {
  const [params] = useSearchParams()
  const prefs = usePrefsStore((s) => s.prefs)
  const storedLastResult = usePrefsStore((s) => s.lastResult)
  const setLastResult = usePrefsStore((s) => s.setLastResult)

  const [form, setForm] = useState(() => ({
    place: '',
    before: '2026-09-01',
    after: '2026-09-13',
    lat: params.get('lat') ?? '-1.5',
    lon: params.get('lon') ?? '-52.0',
  }))
  const [hazard, setHazard] = useState(() => {
    const hz = params.get('hazard')
    return hz && HAZARDS.some((h) => h.id === hz) ? hz : (prefs.defaultHazard ?? 'flood')
  })
  const [auto, setAuto] = useState(() => (params.get('auto') === '1' ? true : prefs.autoDates !== false))
  const [activeJobId, setActiveJobId] = useState<string | null>(null)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [validationError, setValidationError] = useState<string | null>(null)
  const [detail, setDetail] = useState(false)

  const jobQuery = useJobPolling(activeJobId)
  const running =
    Boolean(activeJobId) &&
    jobQuery.data?.status !== 'complete' &&
    jobQuery.data?.status !== 'failed' &&
    !jobQuery.isError

  useEffect(() => {
    if (!running || startedAt === null) return
    const timer = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [running, startedAt])

  useEffect(() => {
    if (jobQuery.data?.status === 'complete' && jobQuery.data.result) {
      setLastResult(jobQuery.data.result)
    }
  }, [jobQuery.data, setLastResult])

  const startMutation = useMutation({
    mutationFn: startHazardJob,
    onSuccess: (res) => {
      setActiveJobId(res.job_id)
      setStartedAt(Date.now())
      setElapsed(0)
    },
  })

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
      if (!/^\d{4}-\d{2}-\d{2}$/.test(form.before) || !/^\d{4}-\d{2}-\d{2}$/.test(form.after)) {
        setValidationError('Dates must be YYYY-MM-DD (or tick auto dates).')
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
    setValidationError(null)
    setDetail(false)
    setActiveJobId(null)
    startMutation.mutate({
      hazard,
      lat,
      lon,
      beforeDate: auto ? undefined : form.before,
      afterDate: auto ? undefined : form.after,
      datasetId: 'nisar_l2_gcov',
      band: 'HH',
    })
  }

  const result = jobQuery.data?.result ?? (running ? null : storedLastResult)
  const previews = {
    before: result?.before_granule?.browse_url ?? undefined,
    after: result?.after_granule?.browse_url ?? undefined,
  }
  const errorMessage =
    validationError ??
    (startMutation.error instanceof Error ? startMutation.error.message : null) ??
    (jobQuery.data?.status === 'failed' ? (jobQuery.data.error ?? 'Analysis failed') : null) ??
    (jobQuery.isError ? `Lost contact with backend: ${jobQuery.error.message}` : null)

  const mmss = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`
  const a = result?.analysis

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Change Analysis</h1>
      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <form onSubmit={run} className="bg-[#0c1424] p-5 rounded-xl border border-white/10 space-y-3">
            <HazardPicker value={hazard} onChange={setHazard} />
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
                  >
                    <Search size={14} />
                  </button>
                </span>
                <span className="text-xs text-white/50">
                  {form.lat}, {form.lon}
                </span>
              </label>
              {!auto && (
                <label className="text-sm">
                  Before
                  <input
                    value={form.before}
                    onChange={(e) => setForm({ ...form, before: e.target.value })}
                    className="mt-1 w-full bg-white/10 rounded px-2 py-1.5"
                  />
                </label>
              )}
              {!auto && (
                <label className="text-sm">
                  After
                  <input
                    value={form.after}
                    onChange={(e) => setForm({ ...form, after: e.target.value })}
                    className="mt-1 w-full bg-white/10 rounded px-2 py-1.5"
                  />
                </label>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-sm">
                Latitude
                <input
                  value={form.lat}
                  onChange={(e) => setForm({ ...form, lat: e.target.value })}
                  className="mt-1 w-full bg-white/10 rounded px-2 py-1.5"
                />
              </label>
              <label className="text-sm">
                Longitude
                <input
                  value={form.lon}
                  onChange={(e) => setForm({ ...form, lon: e.target.value })}
                  className="mt-1 w-full bg-white/10 rounded px-2 py-1.5"
                />
              </label>
            </div>
            <label className="text-sm flex items-center gap-2">
              <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
              Auto dates — newest suitable granule pair (recommended)
            </label>
            <button
              type="submit"
              disabled={running || startMutation.isPending}
              className="w-full md:w-auto bg-blue-600 hover:bg-blue-500 rounded-lg px-8 py-2 text-sm font-semibold disabled:opacity-50"
            >
              {running || startMutation.isPending ? 'Working — results appear below' : 'Compare'}
            </button>
          </form>

          {(running || result) && (
            <div className="grid md:grid-cols-2 gap-4">
              {(['before', 'after'] as const).map((k) => (
                <div key={k} className="bg-[#0c1424] rounded-xl border border-white/10 overflow-hidden">
                  <p className="px-4 pt-3 text-sm font-semibold capitalize">
                    {k}{' '}
                    <span className="text-white/50 font-normal">
                      {result?.actual_granule_dates?.[k] ?? ''}
                    </span>
                  </p>
                  <div className="m-3 h-56 rounded-lg bg-black/40 border border-white/10 flex items-center justify-center overflow-hidden">
                    {previews[k] ? (
                      <img src={previews[k]} alt={`${k} preview`} className="w-full h-full object-cover" />
                    ) : running ? (
                      <p className="text-white/40 text-sm">Preview arrives with the result…</p>
                    ) : (
                      <p className="text-white/40 text-sm text-center px-4">
                        No browse preview published
                        <br />
                        for this granule
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
          {running && (
            <Card title="Analysis in progress">
              <p className="capitalize">
                {jobQuery.data?.stage || 'starting'}… {mmss} elapsed
                {activeJobId ? ` · job ${activeJobId}` : ''}
              </p>
              <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                <div
                  className="h-full bg-cyan-500 transition-all"
                  style={{ width: `${jobQuery.data?.progress ?? 5}%` }}
                />
              </div>
            </Card>
          )}
          {errorMessage && (
            <Card title="Analysis could not complete">
              <p className="text-red-300">{errorMessage}</p>
            </Card>
          )}
          {detail && result && <AnalysisResult result={result} />}
        </div>

        <div className="space-y-4">
          <section className="bg-[#0c1424] rounded-xl border border-white/10 p-5">
            <h2 className="font-semibold mb-3">Analysis Results</h2>
            {!result && <p className="text-sm text-white/50">Run a comparison — live values will appear here.</p>}
            {result && a && (
              <div className="space-y-3 text-sm">
                <div>
                  <p className="text-white/50 text-xs">Affected Area</p>
                  <p className="text-xl font-bold">
                    {a.affected_area_km2 != null ? `${a.affected_area_km2.toFixed(2)} km²` : 'n/a'}
                  </p>
                  <p className="text-[11px] text-white/40">{a.area_basis}</p>
                </div>
                <div>
                  <p className="text-white/50 text-xs">Change Type</p>
                  <p className="font-semibold">{result.hazard_label}</p>
                </div>
                <div>
                  <p className="text-white/50 text-xs">Quality</p>
                  <p className="font-semibold text-amber-200">Indicator — field validation needed</p>
                </div>
                <div>
                  <p className="text-white/50 text-xs">Mean Backscatter Change</p>
                  <p className="font-semibold">{fmt(a.mean_backscatter_difference_db)} dB</p>
                </div>
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
              dB drop beyond −2 dB → possible standing water. Strong change either way → fresh deposits,
              debris or canopy damage. Always check granule dates vs the event date.
            </p>
          </Card>
        </div>
      </div>
    </div>
  )
}
