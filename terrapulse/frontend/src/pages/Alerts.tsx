import { Fragment, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BellPlus, Check, RefreshCw, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { fetchJob } from '../api/analysis'
import {
  acknowledgeAlert,
  createWatchlist,
  deleteWatchlist,
  dismissAlert,
  fetchAlerts,
  fetchWatchlist,
  triggerWatchlistCheck,
} from '../api/watchlist'
import { AnalysisResult } from '../components/AnalysisResult'
import { Card } from '../components/Card'
import { SevBadge } from '../components/SevBadge'
import { useJobs } from '../hooks/useJobs'
import { usePrefsStore } from '../store/usePrefsStore'
import { HAZARDS, hazardLabel, regionName } from '../utils/geo'
import { SEVERITY_RULE_TEXT, severityOf } from '../utils/severity'

export default function Alerts() {
  const qc = useQueryClient()
  const { jobs } = useJobs()
  const [tab, setTab] = useState('all')
  const [openJobId, setOpenJobId] = useState<string | null>(null)
  const viewedIds = usePrefsStore((s) => s.viewedIds)
  const markViewed = usePrefsStore((s) => s.markViewed)

  const [wlName, setWlName] = useState('')
  const [wlLat, setWlLat] = useState('-1.5')
  const [wlLon, setWlLon] = useState('-52.0')
  const [wlHazard, setWlHazard] = useState('flood')
  const [wlThresh, setWlThresh] = useState('Medium')
  const [wlEmail, setWlEmail] = useState('')

  const watchlistQuery = useQuery({ queryKey: ['watchlist'], queryFn: fetchWatchlist })
  const dbAlertsQuery = useQuery({ queryKey: ['db-alerts'], queryFn: fetchAlerts })

  const addWlMut = useMutation({
    mutationFn: createWatchlist,
    onSuccess: () => {
      setWlName('')
      setWlEmail('')
      toast.success('Added location to watchlist')
      void qc.invalidateQueries({ queryKey: ['watchlist'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const delWlMut = useMutation({
    mutationFn: deleteWatchlist,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['watchlist'] }),
  })

  const checkMut = useMutation({
    mutationFn: triggerWatchlistCheck,
    onSuccess: (res) => {
      toast.success(`Checked ${res.checked} sites · ${res.alerts_created} new alerts`)
      void qc.invalidateQueries({ queryKey: ['db-alerts'] })
      void qc.invalidateQueries({ queryKey: ['watchlist'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const ackMut = useMutation({
    mutationFn: acknowledgeAlert,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['db-alerts'] }),
  })

  const dismissMut = useMutation({
    mutationFn: dismissAlert,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['db-alerts'] }),
  })

  const detailQuery = useQuery({
    queryKey: ['job', openJobId],
    queryFn: () => fetchJob(openJobId as string),
    enabled: Boolean(openJobId),
  })

  const rows = jobs
    .filter((j) => j.status === 'complete' || j.status === 'running')
    .map((j) => ({
      job: j,
      sev: j.status === 'running' ? 'Monitoring' : severityOf(j),
      status:
        j.status === 'running'
          ? 'Monitoring'
          : viewedIds.includes(j.job_id)
            ? 'Analyzed'
            : 'New',
    }))
    .sort((a, b) => String(b.job.created_at).localeCompare(String(a.job.created_at)))

  const cnt = {
    all: rows.length,
    High: rows.filter((r) => r.sev === 'High').length,
    Medium: rows.filter((r) => r.sev === 'Medium').length,
    Low: rows.filter((r) => r.sev === 'Low').length,
  }
  const list = tab === 'all' ? rows : rows.filter((r) => r.sev === tab)

  const submitWatchlist = (e: FormEvent) => {
    e.preventDefault()
    const lat = Number.parseFloat(wlLat)
    const lon = Number.parseFloat(wlLon)
    if (!wlName.trim() || !Number.isFinite(lat) || !Number.isFinite(lon)) {
      toast.error('Provide site name and valid coordinates')
      return
    }
    addWlMut.mutate({
      name: wlName.trim(),
      lat,
      lon,
      hazard: wlHazard,
      severity_threshold: wlThresh,
      email: wlEmail.trim() || undefined,
    })
  }

  const toggleView = (jobId: string) => {
    if (openJobId === jobId) {
      setOpenJobId(null)
      return
    }
    setOpenJobId(jobId)
    markViewed(jobId)
  }

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">Alerts &amp; Watchlist Center</h1>
      <p className="text-xs text-white/55">
        <strong>Severity rule (transparent area + confidence):</strong> {SEVERITY_RULE_TEXT}
      </p>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card title="Add Watchlist Location">
          <form onSubmit={submitWatchlist} className="grid grid-cols-2 gap-2 text-xs">
            <input
              value={wlName}
              onChange={(e) => setWlName(e.target.value)}
              placeholder="Site name (e.g. Brahmaputra Basin)"
              className="col-span-2 bg-[#060b16] border border-white/15 rounded px-2.5 py-1.5 text-sm text-white"
            />
            <input
              value={wlLat}
              onChange={(e) => setWlLat(e.target.value)}
              placeholder="Lat"
              className="bg-[#060b16] border border-white/15 rounded px-2.5 py-1.5 text-sm text-white"
            />
            <input
              value={wlLon}
              onChange={(e) => setWlLon(e.target.value)}
              placeholder="Lon"
              className="bg-[#060b16] border border-white/15 rounded px-2.5 py-1.5 text-sm text-white"
            />
            <select
              value={wlHazard}
              onChange={(e) => setWlHazard(e.target.value)}
              className="bg-[#060b16] border border-white/15 rounded px-2 py-1.5 text-sm text-white"
            >
              {HAZARDS.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.label}
                </option>
              ))}
            </select>
            <select
              value={wlThresh}
              onChange={(e) => setWlThresh(e.target.value)}
              className="bg-[#060b16] border border-white/15 rounded px-2 py-1.5 text-sm text-white"
            >
              <option value="Low">Alert &ge; Low</option>
              <option value="Medium">Alert &ge; Medium</option>
              <option value="High">Alert &ge; High</option>
            </select>
            <input
              value={wlEmail}
              onChange={(e) => setWlEmail(e.target.value)}
              placeholder="Optional alert email (uses SMTP env)"
              className="col-span-2 bg-[#060b16] border border-white/15 rounded px-2.5 py-1.5 text-sm text-white"
            />
            <button
              type="submit"
              disabled={addWlMut.isPending}
              className="col-span-2 inline-flex items-center justify-center gap-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold py-1.5"
            >
              <BellPlus size={14} /> Add Watchlist Monitor
            </button>
          </form>
        </Card>

        <Card
          title={`Monitored Sites (${watchlistQuery.data?.length ?? 0})`}
          action={
            <button
              type="button"
              onClick={() => checkMut.mutate()}
              disabled={checkMut.isPending}
              className="inline-flex items-center gap-1 text-xs bg-cyan-600 hover:bg-cyan-500 text-white rounded px-2.5 py-1"
            >
              <RefreshCw size={12} className={checkMut.isPending ? 'animate-spin' : ''} /> Check now
            </button>
          }
        >
          {(watchlistQuery.data?.length ?? 0) === 0 ? (
            <p className="text-xs text-white/50">
              No monitored sites yet. Add coordinates to check automatically every 6h for new NISAR passes.
            </p>
          ) : (
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {watchlistQuery.data!.map((w) => (
                <div key={w.id} className="flex items-center justify-between gap-2 bg-white/5 rounded px-2.5 py-1.5 text-xs">
                  <div className="min-w-0">
                    <p className="text-white font-medium truncate">
                      {w.name} · {hazardLabel(w.hazard)} (&ge;{w.severity_threshold})
                    </p>
                    <p className="text-white/45">
                      {w.lat.toFixed(2)}, {w.lon.toFixed(2)}
                      {w.last_granule_date ? ` · last pass ${w.last_granule_date}` : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => delWlMut.mutate(w.id)}
                    className="text-red-400 hover:text-red-300"
                    aria-label={`Remove watchlist ${w.name}`}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {(dbAlertsQuery.data?.length ?? 0) > 0 && (
        <Card title="Watchlist Triggered Alerts">
          <div className="space-y-2">
            {dbAlertsQuery.data!.map((a) => (
              <div
                key={a.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white/5 border border-white/10 p-3 text-xs"
              >
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <SevBadge level={a.severity === 'High' || a.severity === 'Medium' ? a.severity : 'Low'} />
                    <strong className="text-white">{a.location_name}</strong>
                    {a.acknowledged && <span className="text-emerald-400">(acknowledged)</span>}
                  </div>
                  <p className="text-white/75">{a.message}</p>
                </div>
                <div className="flex items-center gap-2">
                  {!a.acknowledged && (
                    <button
                      type="button"
                      onClick={() => ackMut.mutate(a.id)}
                      className="inline-flex items-center gap-1 rounded bg-emerald-600/80 hover:bg-emerald-600 px-2.5 py-1 text-white"
                    >
                      <Check size={12} /> Ack
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => dismissMut.mutate(a.id)}
                    className="inline-flex items-center gap-1 rounded bg-white/10 hover:bg-white/20 px-2.5 py-1 text-white/80"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="flex flex-wrap gap-2">
        {[
          ['all', `All Runs (${cnt.all})`],
          ['High', `High (${cnt.High})`],
          ['Medium', `Medium (${cnt.Medium})`],
          ['Low', `Low (${cnt.Low})`],
        ].map(([id, label]) => (
          <button
            type="button"
            key={id}
            onClick={() => setTab(id)}
            className={`text-sm rounded-full px-4 py-1.5 ${
              tab === id ? 'bg-blue-600 text-white' : 'bg-white/5 text-white/65 hover:bg-white/10'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {list.length === 0 && (
        <Card title="No run alerts">
          <p>Run analyses to classify findings by affected area and confidence.</p>
        </Card>
      )}
      {list.length > 0 && (
        <div className="bg-[#0c1424] border border-white/10 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-white/50 text-xs border-b border-white/10">
                <th className="p-3">Event</th>
                <th className="p-3">Location</th>
                <th className="p-3">Severity</th>
                <th className="p-3">Detected On</th>
                <th className="p-3">Status</th>
                <th className="p-3">Action</th>
              </tr>
            </thead>
            <tbody>
              {list.map(({ job: j, sev, status }) => (
                <Fragment key={j.job_id}>
                  <tr className="border-b border-white/5">
                    <td className="p-3 text-white">{hazardLabel(j.hazard)} indicator</td>
                    <td className="p-3">{regionName(j.location.lat, j.location.lon)}</td>
                    <td className="p-3">
                      {sev === 'Monitoring' ? (
                        <span className="text-xs text-cyan-300">Monitoring</span>
                      ) : (
                        <SevBadge level={sev} />
                      )}
                    </td>
                    <td className="p-3">{String(j.created_at ?? '').slice(0, 10)}</td>
                    <td className="p-3 text-white/60">{status}</td>
                    <td className="p-3">
                      <button
                        type="button"
                        onClick={() => toggleView(j.job_id)}
                        className="text-xs bg-blue-600 rounded px-3 py-1 text-white"
                      >
                        View
                      </button>
                    </td>
                  </tr>
                  {openJobId === j.job_id && (
                    <tr>
                      <td colSpan={6} className="p-3 bg-black/30">
                        {detailQuery.data?.result ? (
                          <AnalysisResult result={detailQuery.data.result} jobId={j.job_id} />
                        ) : (
                          <p className="text-white/50 text-sm">Loading result…</p>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
