import { Card } from './Card'
import { GranuleCard } from './GranuleCard'
import type { AnalysisResult as AnalysisResultData, GeoJsonCollection } from '../types/api'
import { fmt } from '../utils/format'

export function AnalysisResult({ result }: { result: AnalysisResultData }) {
  const a = result.analysis
  const collections = result.results ? Object.values(result.results) : []
  const firstCollection = collections.find(
    (v): v is GeoJsonCollection => Boolean(v && Array.isArray(v.features)),
  )
  const feats = firstCollection?.features ?? []

  return (
    <div className="space-y-4">
      <Card
        title={
          result.status === 'metadata_only'
            ? 'Granules found — pixels not streamed'
            : `Live result · ${result.hazard_label ?? 'change'}`
        }
      >
        <p>
          <span className="text-white/50">Source:</span> {result.data_source}
        </p>
        {result.short_name && (
          <p>
            <span className="text-white/50">Collection:</span> {result.short_name}
          </p>
        )}
        {result.interpretation && <p className="text-cyan-100/90">{result.interpretation}</p>}
        {result.auto_dates && result.actual_granule_dates && (
          <p className="text-xs">
            Auto pair: {result.actual_granule_dates.before} → {result.actual_granule_dates.after}
          </p>
        )}
        {result.processing_note && <p className="text-amber-200">{result.processing_note}</p>}
        {a && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 pt-1">
            <div className="bg-white/5 rounded-lg p-3">
              <p className="text-white/50 text-xs">Mean Δ (dB)</p>
              <p className="text-white text-lg font-semibold">{fmt(a.mean_backscatter_difference_db)}</p>
            </div>
            <div className="bg-white/5 rounded-lg p-3">
              <p className="text-white/50 text-xs">Pixels darker</p>
              <p className="text-white text-lg font-semibold">{fmt(a.percentage_decrease, 1)}%</p>
            </div>
            {a.percentage_disturbed !== undefined && a.percentage_disturbed !== null && (
              <div className="bg-white/5 rounded-lg p-3">
                <p className="text-white/50 text-xs">Pixels disturbed</p>
                <p className="text-white text-lg font-semibold">{fmt(a.percentage_disturbed, 1)}%</p>
              </div>
            )}
            <div className="bg-white/5 rounded-lg p-3">
              <p className="text-white/50 text-xs">Outlines</p>
              <p className="text-white text-lg font-semibold">{feats.length}</p>
            </div>
          </div>
        )}
        <div className="grid md:grid-cols-2 gap-2 pt-1">
          <GranuleCard label="Before granule" granule={result.before_granule} />
          <GranuleCard label="After granule" granule={result.after_granule} />
        </div>
        {result.caveats_and_limitations && (
          <>
            <p className="font-semibold text-white pt-2">Limitations — read before concluding anything</p>
            <ul className="list-disc pl-5 space-y-1">
              {result.caveats_and_limitations.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          </>
        )}
      </Card>
    </div>
  )
}
