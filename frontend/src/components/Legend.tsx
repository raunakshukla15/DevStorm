import { HAZARDS } from '../utils/geo'

export function GradientLegend() {
  return (
    <div className="bg-[#0c1424]/95 border border-white/10 rounded-xl px-3 py-2">
      <p className="text-[11px] font-semibold">Change intensity (dB)</p>
      <div
        className="w-36 h-2 rounded-full"
        style={{ background: 'linear-gradient(90deg,#0ea5e9,#22c55e,#eab308,#ef4444)' }}
      />
      <div className="flex justify-between text-[10px] text-white/50">
        <span>Low</span>
        <span>High</span>
      </div>
    </div>
  )
}

export function HazardLegend() {
  return (
    <div className="flex flex-wrap gap-3 text-xs text-white/60">
      {HAZARDS.map((h) => (
        <span key={h.id} className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: h.color }} />
          {h.label}
        </span>
      ))}
    </div>
  )
}
