import { Download, Link as LinkIcon } from 'lucide-react'
import { toast } from 'sonner'
import { jobExportUrl } from '../api/analysis'
import { usePrefsStore } from '../store/usePrefsStore'
import type { AnalysisResult as AnalysisResultData, GeoJsonCollection } from '../types/api'
import { downloadFile, fmt, formatArea, formatPower } from '../utils/format'
import { Card } from './Card'
import { ChangeCharts } from './ChangeCharts'
import { GranuleCard } from './GranuleCard'
import { ResultMapOverlay } from './ResultMapOverlay'
import { SevBadge } from './SevBadge'

export function AnalysisResult({
  result,
  jobId,
}: {
  result: AnalysisResultData
  jobId?: string | null
}) {
  const areaUnit = usePrefsStore((s) => s.prefs.areaUnit)
  const powerUnit = usePrefsStore((s) => s.prefs.powerUnit)

  const a = result.analysis
  const collections = result.results ? Object.values(result.results) : []
  const firstCollection = collections.find(
    (v): v is GeoJsonCollection => Boolean(v && Array.isArray(v.features)),
  )
  const feats = firstCollection?.features ?? []

  const copyShareLink = async () => {
    if (!jobId) return
    const url = `${window.location.origin}/results/${encodeURIComponent(jobId)}`
    try {
      await navigator.clipboard.writeText(url)
      toast.success('Copied shareable result link')
    } catch {
      toast.message('Share URL ready', { description: url })
    }
  }

  return (
    <div className="space-y-4">
      {result.is_sample && (
        <div className="rounded-xl border border-amber-400/40 bg-amber-500/10 px-4 py-2.5 text-xs text-amber-200">
          <strong>Guided Sample Demonstration:</strong> This walkthrough displays a precomputed NISAR L2
          GCOV grid window. Submit a live run above to stream current Earthdata granules.
        </div>
      )}

      <Card
        title={
          result.status === 'metadata_only'
            ? 'Granules found — pixels not streamed'
            : `Result · ${result.hazard_label ?? 'change'}`
        }
        action={
          <div className="flex flex-wrap items-center gap-2">
            {result.severity && <SevBadge level={result.severity} />}
            {result.confidence?.level && (
              <span className="text-xs rounded-full px-2.5 py-0.5 bg-cyan-500/20 text-cyan-200">
                Confidence: {result.confidence.level}
                {typeof result.confidence.score === 'number'
                  ? ` (${Math.round(result.confidence.score * 100)}%)`
                  : ''}
              </span>
            )}
            {jobId && !result.is_sample && (
              <button
                type="button"
                onClick={copyShareLink}
                className="inline-flex items-center gap-1 rounded-lg bg-white/10 hover:bg-white/20 px-2.5 py-1 text-xs text-white"
              >
                <LinkIcon size={12} /> Share link
              </button>
            )}
          </div>
        }
      >
        <p>
          <span className="text-white/50">Source:</span> {result.data_source}
        </p>
        {result.short_name && (
          <p>
            <span className="text-white/50">Collection:</span> {result.short_name} · Band{' '}
            {result.polarization_band ?? 'HH'}
            {result.speckle_filter && result.speckle_filter !== 'none'
              ? ` · Speckle: ${result.speckle_filter}`
              : ''}
            {result.threshold_mode && result.threshold_mode !== 'fixed'
              ? ` · Threshold: ${result.threshold_mode} (${fmt(result.threshold_db, 2)} dB)`
              : ''}
          </p>
        )}
        {result.interpretation && <p className="text-cyan-100/90">{result.interpretation}</p>}
        {result.auto_dates && result.actual_granule_dates && (
          <p className="text-xs">
            Auto pair: {result.actual_granule_dates.before} → {result.actual_granule_dates.after}
            {result.same_orbit_pair === true
              ? ' (same orbit)'
              : result.same_orbit_pair === false
                ? ' (cross-orbit — lower confidence)'
                : ''}
          </p>
        )}
        {result.processing_note && <p className="text-amber-200">{result.processing_note}</p>}

        {a && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 pt-1">
            <div className="bg-white/5 rounded-lg p-3">
              <p className="text-white/50 text-xs">
                {result.detection_mode === 'insar_phase' ? 'Mean LOS disp.' : 'Mean Δ'}
              </p>
              <p className="text-white text-lg font-semibold">
                {result.detection_mode === 'insar_phase'
                  ? `${fmt(a.mean_backscatter_difference_db, 2)} cm`
                  : formatPower(a.mean_backscatter_difference_db, powerUnit)}
              </p>
            </div>
            <div className="bg-white/5 rounded-lg p-3">
              <p className="text-white/50 text-xs">Affected area</p>
              <p className="text-white text-lg font-semibold">{formatArea(a.affected_area_km2, areaUnit)}</p>
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
              <p className="text-white/50 text-xs">Polygons</p>
              <p className="text-white text-lg font-semibold">{feats.length}</p>
            </div>
          </div>
        )}

        {result.raw_stats && a && (
          <div className="rounded-lg bg-white/5 border border-white/10 p-3 text-xs flex flex-wrap items-center justify-between gap-2">
            <span>
              <strong>Speckle noise reduction ({result.speckle_filter}):</strong> Difference std reduced
              from <strong>{fmt(result.raw_stats.std_difference_db, 2)} dB</strong> (raw) to{' '}
              <strong>{fmt(a.std_difference_db, 2)} dB</strong> (filtered)
            </span>
            {result.windows?.downsampled && (
              <span className="text-cyan-300">AOI stride-downsampled {result.windows.stride}×</span>
            )}
          </div>
        )}

        {result.auxiliary_masks && (result.auxiliary_masks.water_mask_requested || result.auxiliary_masks.slope_mask_requested) && (
          <div className="rounded-lg bg-slate-800/70 border border-white/10 p-3 text-xs space-y-1">
            <p className="font-semibold text-white">Auxiliary mask status ({result.auxiliary_masks.status})</p>
            {result.auxiliary_masks.notes.map((n, idx) => (
              <p key={idx} className="text-white/70">
                {n}
              </p>
            ))}
          </div>
        )}

        {result.status === 'analyzed' && <ChangeCharts result={result} />}

        {result.status === 'analyzed' && (result.windows?.bounds || feats.length > 0) && (
          <div className="pt-2">
            <ResultMapOverlay result={result} jobId={jobId} />
          </div>
        )}

        <div className="flex flex-wrap gap-2 pt-2 no-print">
          {firstCollection && (
            <button
              type="button"
              onClick={() =>
                downloadFile(
                  `terrapulse-${jobId ?? 'result'}.geojson`,
                  JSON.stringify(firstCollection, null, 2),
                  'application/geo+json',
                )
              }
              className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 hover:bg-white/20 px-3 py-1.5 text-xs text-white"
            >
              <Download size={13} /> GeoJSON
            </button>
          )}
          {jobId && !result.is_sample && (
            <>
              <a
                href={jobExportUrl(jobId, 'tif')}
                className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 hover:bg-white/20 px-3 py-1.5 text-xs text-white"
              >
                <Download size={13} /> GeoTIFF
              </a>
              <a
                href={jobExportUrl(jobId, 'csv')}
                className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 hover:bg-white/20 px-3 py-1.5 text-xs text-white"
              >
                <Download size={13} /> CSV
              </a>
              <a
                href={jobExportUrl(jobId, 'png')}
                className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 hover:bg-white/20 px-3 py-1.5 text-xs text-white"
              >
                <Download size={13} /> PNG
              </a>
              <a
                href={jobExportUrl(jobId, 'pdf')}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 px-3 py-1.5 text-xs text-white"
              >
                <Download size={13} /> PDF Report
              </a>
            </>
          )}
        </div>

        <div className="grid md:grid-cols-2 gap-2 pt-1">
          <GranuleCard label="Before granule" granule={result.before_granule} />
          <GranuleCard label="After granule" granule={result.after_granule} />
        </div>

        {result.confidence?.formula && (
          <p className="text-xs text-white/50 pt-1">
            <strong>Confidence formula:</strong> <code className="text-cyan-200/80">{result.confidence.formula}</code>
          </p>
        )}

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
