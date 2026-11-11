import { useState } from 'react'
import { GeoJSON, ImageOverlay, LayersControl } from 'react-leaflet'
import { jobImageUrl } from '../api/analysis'
import { usePrefsStore } from '../store/usePrefsStore'
import type { AnalysisResult, GeoJsonCollection } from '../types/api'
import { fmt, formatArea } from '../utils/format'
import { hazardColor } from '../utils/geo'
import { MapBase } from './MapBase'

export function ResultMapOverlay({
  result,
  jobId,
}: {
  result: AnalysisResult
  jobId?: string | null
}) {
  const areaUnit = usePrefsStore((s) => s.prefs.areaUnit)
  const baseLayer = usePrefsStore((s) => s.prefs.baseLayer)
  const [opacity, setOpacity] = useState(0.75)
  const [overlayLayer, setOverlayLayer] = useState<'difference' | 'rgb' | 'none'>('difference')
  const [swipePct, setSwipePct] = useState(50)

  const bounds = result.windows?.bounds ?? null
  const center: [number, number] = bounds
    ? [(bounds[0][0] + bounds[1][0]) / 2, (bounds[0][1] + bounds[1][1]) / 2]
    : [result.location?.lat ?? 0, result.location?.lon ?? 0]

  const collections = result.results ? Object.values(result.results) : []
  const fc = collections.find((v): v is GeoJsonCollection => Boolean(v && Array.isArray(v.features)))
  const color = hazardColor(result.hazard ?? 'flood')

  const effectiveJobId = jobId ?? ''
  const diffImg = result.images?.difference && effectiveJobId ? jobImageUrl(effectiveJobId, 'difference.png') : null
  const rgbImg = result.images?.rgb && effectiveJobId ? jobImageUrl(effectiveJobId, 'rgb.png') : null
  const beforeImg = result.images?.before && effectiveJobId ? jobImageUrl(effectiveJobId, 'before.png') : null
  const afterImg = result.images?.after && effectiveJobId ? jobImageUrl(effectiveJobId, 'after.png') : null
  const activeOverlay = overlayLayer === 'difference' ? diffImg : overlayLayer === 'rgb' ? rgbImg : null

  const beforeDate = result.actual_granule_dates?.before?.slice(0, 10) ?? result.requested_dates?.before ?? 'pre'
  const afterDate = result.actual_granule_dates?.after?.slice(0, 10) ?? result.requested_dates?.after ?? 'latest'

  return (
    <div className="space-y-3">
      {(beforeImg || afterImg || diffImg) && (
        <div
          className="grid grid-cols-1 md:grid-cols-3 gap-3 rounded-xl border border-white/10 bg-[#0a1120] p-3"
          data-testid="side-by-side-images"
        >
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-amber-200">1. Before Pass</span>
              <span className="text-white/60">{beforeDate}</span>
            </div>
            <div className="aspect-square w-full overflow-hidden rounded-lg border border-white/10 bg-black/50 flex items-center justify-center">
              {beforeImg ? (
                <img
                  src={beforeImg}
                  alt={`Before NISAR backscatter (${beforeDate})`}
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="text-xs text-white/40">No raster image</span>
              )}
            </div>
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-cyan-200">2. After Pass (Latest)</span>
              <span className="text-white/60">{afterDate}</span>
            </div>
            <div className="aspect-square w-full overflow-hidden rounded-lg border border-white/10 bg-black/50 flex items-center justify-center">
              {afterImg ? (
                <img
                  src={afterImg}
                  alt={`After NISAR backscatter (${afterDate})`}
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="text-xs text-white/40">No raster image</span>
              )}
            </div>
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-rose-200">3. Detected Change</span>
              <span className="text-white/60">
                {fmt(result.analysis?.mean_backscatter_difference_db, 2)} dB mean
              </span>
            </div>
            <div className="aspect-square w-full overflow-hidden rounded-lg border border-white/10 bg-black/50 flex items-center justify-center">
              {diffImg ? (
                <img
                  src={diffImg}
                  alt={`Detected NISAR backscatter change (${beforeDate} to ${afterDate})`}
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="text-xs text-white/40">No change map</span>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2">
          <span className="text-white/60">Raster overlay:</span>
          {(['difference', 'rgb', 'none'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setOverlayLayer(m)}
              className={`rounded px-2.5 py-1 capitalize ${
                overlayLayer === m ? 'bg-blue-600 text-white' : 'bg-white/5 text-white/70 hover:bg-white/10'
              }`}
            >
              {m === 'difference' ? 'Δ Diff' : m === 'rgb' ? 'RGB Composite' : 'Outlines only'}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-white/65">
          Opacity {Math.round(opacity * 100)}%
          <input
            type="range"
            min={0.1}
            max={1}
            step={0.05}
            value={opacity}
            onChange={(e) => setOpacity(Number(e.target.value))}
            className="w-24 accent-blue-500"
          />
        </label>
      </div>

      <div className="h-[380px] rounded-xl overflow-hidden border border-white/15">
        <MapBase center={center} zoom={bounds ? 12 : 9} baseLayer={baseLayer}>
          <LayersControl position="topright">
            {fc && fc.features.length > 0 && (
              <LayersControl.Overlay checked name="Detected Change Polygons">
                <GeoJSON
                  key={`${effectiveJobId}-${fc.features.length}`}
                  data={fc as unknown as GeoJSON.GeoJsonObject}
                  style={{
                    color,
                    weight: 2,
                    fillColor: color,
                    fillOpacity: 0.35,
                  }}
                  onEachFeature={(feature, layer) => {
                    const p = (feature.properties ?? {}) as Record<string, number | string | undefined>
                    const areaStr = typeof p.area_km2 === 'number' ? formatArea(p.area_km2, areaUnit) : 'n/a'
                    const meanStr = fmt(typeof p.mean_difference_db === 'number' ? p.mean_difference_db : null, 2)
                    const confStr =
                      typeof p.confidence_score === 'number'
                        ? `${p.confidence_level ?? ''} (${(p.confidence_score * 100).toFixed(0)}%)`
                        : 'indicator'
                    layer.bindPopup(
                      `<strong>Area:</strong> ${areaStr}<br/>` +
                        `<strong>Mean diff:</strong> ${meanStr} dB<br/>` +
                        `<strong>Pixels:</strong> ${p.pixel_count ?? 'n/a'}<br/>` +
                        `<strong>Confidence:</strong> ${confStr}`,
                    )
                  }}
                />
              </LayersControl.Overlay>
            )}
          </LayersControl>
          {bounds && activeOverlay && (
            <ImageOverlay url={activeOverlay} bounds={bounds} opacity={opacity} />
          )}
        </MapBase>
      </div>

      {beforeImg && afterImg && (
        <div className="bg-[#0a1120] border border-white/10 rounded-xl p-3 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="font-semibold text-white">Before / After Backscatter Swipe</span>
            <span className="text-white/55">
              Left: Before ({result.actual_granule_dates?.before ?? 'pre'}) · Right: After (
              {result.actual_granule_dates?.after ?? 'post'})
            </span>
          </div>
          <div className="relative mx-auto w-full max-w-md aspect-square rounded-lg overflow-hidden border border-white/15 select-none bg-black">
            <img
              src={afterImg}
              alt="After NISAR backscatter window"
              className="absolute inset-0 w-full h-full object-cover"
            />
            <img
              src={beforeImg}
              alt="Before NISAR backscatter window"
              className="absolute inset-0 w-full h-full object-cover"
              style={{ clipPath: `inset(0 ${100 - swipePct}% 0 0)` }}
            />
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-cyan-400 pointer-events-none"
              style={{ left: `${swipePct}%` }}
            />
            <span className="absolute top-2 left-2 text-[10px] font-semibold bg-black/70 text-white px-2 py-0.5 rounded">
              Before
            </span>
            <span className="absolute top-2 right-2 text-[10px] font-semibold bg-black/70 text-white px-2 py-0.5 rounded">
              After
            </span>
          </div>
          <label className="flex items-center gap-3 text-xs text-white/65 max-w-md mx-auto">
            <span>Before</span>
            <input
              type="range"
              min={0}
              max={100}
              value={swipePct}
              onChange={(e) => setSwipePct(Number(e.target.value))}
              className="flex-1 accent-cyan-400"
              aria-label="Before and after swipe position"
            />
            <span>After</span>
          </label>
        </div>
      )}
    </div>
  )
}
