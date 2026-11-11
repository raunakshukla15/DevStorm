import { useState } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { AnalysisResult } from '../types/api'

interface ChangeChartsProps {
  result: AnalysisResult
}

export function ChangeCharts({ result }: ChangeChartsProps) {
  const [deltaMode, setDeltaMode] = useState<'classes' | 'histogram'>('classes')

  const comp = result.comparison
  const bsHist = result.backscatter_histogram ?? []
  const dHist = result.delta_histogram ?? []
  const breakdown = result.condition_breakdown ?? []
  const transect = result.transect ?? []

  if (!comp && bsHist.length === 0 && breakdown.length === 0) {
    return null
  }

  const beforeDate =
    result.actual_granule_dates?.before?.slice(0, 10) ??
    result.requested_dates?.before ??
    'Before'
  const afterDate =
    result.actual_granule_dates?.after?.slice(0, 10) ??
    result.requested_dates?.after ??
    'After'

  return (
    <div className="space-y-4 rounded-xl border border-white/10 bg-[#0b1322] p-4" data-testid="change-charts">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-white">
              Before vs After Backscatter Comparison ({beforeDate} → {afterDate})
            </h3>
            <span
              className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                result.is_sample
                  ? 'border border-amber-500/40 bg-amber-500/15 text-amber-200'
                  : 'border border-emerald-500/40 bg-emerald-500/15 text-emerald-200'
              }`}
            >
              {result.is_sample ? 'Sample demonstration' : 'Live NASA Earthdata NISAR'}
            </span>
          </div>
          {comp && (
            <p className="mt-1 text-xs text-white/60">
              Mean σ⁰ shifted from <strong className="text-amber-300">{comp.before_mean_db.toFixed(2)} dB</strong> (
              {beforeDate}) to <strong className="text-cyan-300">{comp.after_mean_db.toFixed(2)} dB</strong> (
              {afterDate}) — net change{' '}
              <strong className={comp.delta_mean_db < 0 ? 'text-cyan-300' : 'text-amber-300'}>
                {comp.delta_mean_db >= 0 ? '+' : ''}
                {comp.delta_mean_db.toFixed(2)} dB
              </strong>
              .
            </p>
          )}
        </div>
        {result.timing && (
          <div className="flex flex-wrap gap-2 text-[11px] text-white/65">
            <span className="rounded bg-white/5 px-2 py-1">CMR: {result.timing.cmr_search_s}s</span>
            <span className="rounded bg-white/5 px-2 py-1">HDF5 Stream: {result.timing.stream_s}s</span>
            <span className="rounded bg-cyan-500/15 px-2 py-1 text-cyan-200">
              Total: {result.timing.total_s}s
            </span>
          </div>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {bsHist.length > 0 && (
          <div className="rounded-xl border border-white/10 bg-[#080f1d] p-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-semibold text-white/90">
                Backscatter Intensity Distribution (Before vs After, % pixels)
              </p>
              <span className="text-[11px] text-white/45">dB bins (L-band)</span>
            </div>
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={bsHist} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                  <XAxis dataKey="bin" stroke="rgba(255,255,255,0.5)" fontSize={10} />
                  <YAxis stroke="rgba(255,255,255,0.5)" fontSize={11} unit="%" />
                  <Tooltip
                    contentStyle={{
                      background: '#0f172a',
                      border: '1px solid rgba(255,255,255,0.15)',
                      fontSize: '12px',
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: '11px' }} />
                  <Area
                    type="monotone"
                    dataKey="before_pct"
                    name={`Before (${beforeDate})`}
                    stroke="#f59e0b"
                    fill="#f59e0b"
                    fillOpacity={0.22}
                    strokeWidth={2}
                  />
                  <Area
                    type="monotone"
                    dataKey="after_pct"
                    name={`After (${afterDate})`}
                    stroke="#22d3ee"
                    fill="#22d3ee"
                    fillOpacity={0.22}
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            {comp && (
              <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-white/70">
                <div className="rounded bg-white/5 px-2.5 py-1.5">
                  <span className="text-amber-300 font-medium">Before ({beforeDate}):</span> mean{' '}
                  {comp.before_mean_db.toFixed(2)} dB · median {comp.before_median_db.toFixed(2)} dB · P10–P90{' '}
                  {comp.before_p10_db.toFixed(1)}..{comp.before_p90_db.toFixed(1)} dB
                </div>
                <div className="rounded bg-white/5 px-2.5 py-1.5">
                  <span className="text-cyan-300 font-medium">After ({afterDate}):</span> mean{' '}
                  {comp.after_mean_db.toFixed(2)} dB · median {comp.after_median_db.toFixed(2)} dB · P10–P90{' '}
                  {comp.after_p10_db.toFixed(1)}..{comp.after_p90_db.toFixed(1)} dB
                </div>
              </div>
            )}
          </div>
        )}

        {(breakdown.length > 0 || dHist.length > 0) && (
          <div className="rounded-xl border border-white/10 bg-[#080f1d] p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-white/90">
                {deltaMode === 'classes'
                  ? 'Surface Change Classification (% of valid pixels)'
                  : 'Δ Backscatter Shift Histogram (After − Before dB)'}
              </p>
              <div className="flex gap-1 rounded bg-white/5 p-0.5 text-[11px]">
                <button
                  type="button"
                  onClick={() => setDeltaMode('classes')}
                  className={`rounded px-2 py-0.5 ${
                    deltaMode === 'classes' ? 'bg-blue-600 text-white' : 'text-white/60 hover:text-white'
                  }`}
                >
                  Classes
                </button>
                <button
                  type="button"
                  onClick={() => setDeltaMode('histogram')}
                  className={`rounded px-2 py-0.5 ${
                    deltaMode === 'histogram' ? 'bg-blue-600 text-white' : 'text-white/60 hover:text-white'
                  }`}
                >
                  Δ dB Bins
                </button>
              </div>
            </div>
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                {deltaMode === 'classes' ? (
                  <BarChart
                    data={breakdown}
                    layout="vertical"
                    margin={{ top: 4, right: 18, left: 8, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                    <XAxis type="number" stroke="rgba(255,255,255,0.5)" fontSize={11} unit="%" />
                    <YAxis
                      type="category"
                      dataKey="label"
                      stroke="rgba(255,255,255,0.65)"
                      fontSize={10}
                      width={132}
                    />
                    <Tooltip
                      contentStyle={{
                        background: '#0f172a',
                        border: '1px solid rgba(255,255,255,0.15)',
                        fontSize: '12px',
                      }}
                    />
                    <Bar dataKey="pct" name="% pixels" radius={[0, 4, 4, 0]}>
                      {breakdown.map((entry) => (
                        <Cell key={entry.key} fill={entry.color} />
                      ))}
                    </Bar>
                  </BarChart>
                ) : (
                  <BarChart data={dHist} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                    <XAxis dataKey="bin" stroke="rgba(255,255,255,0.5)" fontSize={10} />
                    <YAxis stroke="rgba(255,255,255,0.5)" fontSize={11} unit="%" />
                    <Tooltip
                      contentStyle={{
                        background: '#0f172a',
                        border: '1px solid rgba(255,255,255,0.15)',
                        fontSize: '12px',
                      }}
                    />
                    <Bar dataKey="pct" name="% pixels" radius={[3, 3, 0, 0]}>
                      {dHist.map((entry) => (
                        <Cell
                          key={entry.bin}
                          fill={
                            entry.direction === 'drop'
                              ? '#22d3ee'
                              : entry.direction === 'gain'
                                ? '#f59e0b'
                                : '#64748b'
                          }
                        />
                      ))}
                    </Bar>
                  </BarChart>
                )}
              </ResponsiveContainer>
            </div>
            {comp && (
              <p className="mt-2 text-[11px] text-white/55">
                Negative Δ dB = smoother/darker radar return (flood water / wet surface); Positive Δ dB = rougher
                or higher dielectric scattering (debris / soil moisture). Threshold used: {comp.threshold_db.toFixed(2)}{' '}
                dB.
              </p>
            )}
          </div>
        )}
      </div>

      {transect.length > 1 && (
        <div className="rounded-xl border border-white/10 bg-[#080f1d] p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold text-white/90">
              Center Swath Radar Transect (West → East Across Window, dB)
            </p>
            <span className="text-[11px] text-white/45">
              {transect.length} real sampled points across the window centerline
            </span>
          </div>
          <div className="h-52 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={transect} margin={{ top: 8, right: 14, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                <XAxis
                  dataKey="offset_km"
                  stroke="rgba(255,255,255,0.5)"
                  fontSize={11}
                  tickFormatter={(v) => `${v} km`}
                />
                <YAxis stroke="rgba(255,255,255,0.5)" fontSize={11} unit=" dB" />
                <Tooltip
                  contentStyle={{
                    background: '#0f172a',
                    border: '1px solid rgba(255,255,255,0.15)',
                    fontSize: '12px',
                  }}
                />
                <Legend wrapperStyle={{ fontSize: '11px' }} />
                {comp && (
                  <ReferenceLine
                    y={comp.before_mean_db}
                    stroke="rgba(245,158,11,0.35)"
                    strokeDasharray="4 4"
                  />
                )}
                <Line
                  type="monotone"
                  dataKey="before_db"
                  name={`Before (${beforeDate})`}
                  stroke="#f59e0b"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="after_db"
                  name={`After (${afterDate})`}
                  stroke="#22d3ee"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  )
}

