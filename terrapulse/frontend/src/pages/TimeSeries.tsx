import { useState, type FormEvent } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { toast } from 'sonner'
import { fetchTimeseries, startTimeseries } from '../api/timeseries'
import { Card } from '../components/Card'
import { fmt } from '../utils/format'

export default function TimeSeries() {
  const [params] = useSearchParams()
  const [lat, setLat] = useState(() => params.get('lat') ?? '-1.5')
  const [lon, setLon] = useState(() => params.get('lon') ?? '-52.0')
  const [band, setBand] = useState('HH')
  const [months, setMonths] = useState(6)
  const [seriesId, setSeriesId] = useState<string | null>(null)

  const startMut = useMutation({
    mutationFn: startTimeseries,
    onSuccess: (data) => {
      setSeriesId(data.series_id)
      toast.success('Time series extraction started')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const tsQuery = useQuery({
    queryKey: ['timeseries', seriesId],
    queryFn: () => fetchTimeseries(seriesId as string),
    enabled: Boolean(seriesId),
    refetchInterval: (q) => {
      const s = q.state.data?.status
      return s === 'completed' || s === 'failed' ? false : 3000
    },
  })

  const run = (e: FormEvent) => {
    e.preventDefault()
    const la = Number.parseFloat(lat)
    const lo = Number.parseFloat(lon)
    if (!Number.isFinite(la) || la < -90 || la > 90 || !Number.isFinite(lo) || lo < -180 || lo > 180) {
      toast.error('Latitude must be -90..90 and longitude -180..180')
      return
    }
    startMut.mutate({ lat: la, lon: lo, band, months })
  }

  const ts = tsQuery.data
  const points = ts?.points ?? []

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Multi-Date SAR Time Series</h1>
      <p className="text-sm text-white/60">
        Streams compact 64x64 pixel windows across every NISAR pass over this point so seasonal moisture
        baselines and sudden drops stand out clearly.
      </p>

      <Card title="Extract point time series">
        <form onSubmit={run} className="grid sm:grid-cols-5 gap-3 items-end">
          <label className="text-xs text-white/60 block">
            Latitude
            <input
              value={lat}
              onChange={(e) => setLat(e.target.value)}
              className="mt-1 w-full bg-[#060b16] border border-white/15 rounded px-3 py-2 text-sm text-white"
            />
          </label>
          <label className="text-xs text-white/60 block">
            Longitude
            <input
              value={lon}
              onChange={(e) => setLon(e.target.value)}
              className="mt-1 w-full bg-[#060b16] border border-white/15 rounded px-3 py-2 text-sm text-white"
            />
          </label>
          <label className="text-xs text-white/60 block">
            Band
            <select
              value={band}
              onChange={(e) => setBand(e.target.value)}
              className="mt-1 w-full bg-[#060b16] border border-white/15 rounded px-3 py-2 text-sm text-white"
            >
              <option value="HH">HH</option>
              <option value="HV">HV</option>
              <option value="VV">VV</option>
              <option value="HH/HV">HH/HV ratio</option>
            </select>
          </label>
          <label className="text-xs text-white/60 block">
            Months
            <select
              value={months}
              onChange={(e) => setMonths(Number(e.target.value))}
              className="mt-1 w-full bg-[#060b16] border border-white/15 rounded px-3 py-2 text-sm text-white"
            >
              <option value={3}>3 months</option>
              <option value={6}>6 months</option>
              <option value={12}>12 months</option>
            </select>
          </label>
          <button
            type="submit"
            disabled={startMut.isPending}
            className="rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-semibold py-2 px-4"
          >
            {startMut.isPending ? 'Starting…' : 'Build curve'}
          </button>
        </form>
      </Card>

      {ts && (
        <Card
          title={`Backscatter curve · ${ts.band} (${ts.lat}, ${ts.lon})`}
          action={
            <span className="text-xs text-cyan-300">
              {ts.status} · {ts.processed_granules ?? points.length}/{ts.total_granules ?? '?'} passes
            </span>
          }
        >
          {ts.error && <p className="text-red-400 text-xs">{ts.error}</p>}
          {points.length > 0 ? (
            <>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={points}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                    <XAxis dataKey="acquisition_date" stroke="#94a3b8" fontSize={11} />
                    <YAxis stroke="#94a3b8" fontSize={11} unit=" dB" />
                    <Tooltip
                      contentStyle={{ background: '#0c1424', border: '1px solid rgba(255,255,255,0.15)' }}
                    />
                    <Line type="monotone" dataKey="mean_db" stroke="#22d3ee" strokeWidth={2} dot />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="overflow-x-auto pt-2">
                <table className="w-full text-xs text-left">
                  <thead className="text-white/50 border-b border-white/10">
                    <tr>
                      <th className="py-1.5">Date</th>
                      <th className="py-1.5">Mean (dB)</th>
                      <th className="py-1.5">Std (dB)</th>
                      <th className="py-1.5">Orbit</th>
                      <th className="py-1.5">Valid pixels</th>
                    </tr>
                  </thead>
                  <tbody>
                    {points.map((p, idx) => (
                      <tr key={idx} className="border-b border-white/5">
                        <td className="py-1.5">{p.acquisition_date}</td>
                        <td className="py-1.5 font-mono">{fmt(p.mean_db, 2)}</td>
                        <td className="py-1.5 font-mono">{fmt(p.std_db, 2)}</td>
                        <td className="py-1.5">{p.orbit_direction}</td>
                        <td className="py-1.5">{p.valid_pixels ?? 'n/a'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <p className="text-xs text-white/55">
              {ts.status === 'running'
                ? 'Streaming granule windows from Earthdata… chart updates incrementally.'
                : 'No valid pixel samples found across this time window.'}
            </p>
          )}
        </Card>
      )}
    </div>
  )
}
