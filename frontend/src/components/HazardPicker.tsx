import { HAZARDS } from '../utils/geo'

export function HazardPicker({
  value,
  onChange,
  variant = 'pill',
}: {
  value: string
  onChange: (hazardId: string) => void
  variant?: 'pill' | 'chip'
}) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Select surface hazard mode">
      {HAZARDS.map((h) => {
        const selected = value === h.id
        return (
          <button
            type="button"
            key={h.id}
            aria-pressed={selected}
            onClick={() => onChange(h.id)}
            className={
              variant === 'pill'
                ? `inline-flex items-center gap-1.5 text-sm rounded-full px-3.5 py-1.5 font-medium transition-all cursor-pointer ${
                    selected
                      ? 'bg-cyan-600 text-white tp-keep-white border border-cyan-400 shadow-sm'
                      : 'bg-white/5 border border-white/15 text-white/70 hover:bg-white/10 hover:border-white/25 hover:text-white'
                  }`
                : `inline-flex items-center gap-1.5 text-xs rounded-full px-3 py-1.5 font-medium transition-all cursor-pointer ${
                    selected
                      ? 'bg-cyan-600 text-white tp-keep-white border border-cyan-400 shadow-sm'
                      : 'bg-white/10 border border-white/15 text-white/75 hover:bg-white/20 hover:text-white'
                  }`
            }
          >
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: h.color }}
              aria-hidden="true"
            />
            <span>{h.label}</span>
          </button>
        )
      })}
    </div>
  )
}
