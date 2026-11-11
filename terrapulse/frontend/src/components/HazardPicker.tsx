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
    <div className="flex flex-wrap gap-2">
      {HAZARDS.map((h) => (
        <button
          type="button"
          key={h.id}
          onClick={() => onChange(h.id)}
          className={
            variant === 'pill'
              ? `text-sm rounded-full px-4 py-1.5 font-medium ${
                  value === h.id ? 'bg-cyan-600 text-white' : 'border border-white/15 text-white/70 hover:bg-white/10'
                }`
              : `text-xs rounded-full px-3 py-1.5 font-medium text-white ${
                  value === h.id ? 'bg-cyan-600' : 'bg-white/10 hover:bg-white/20'
                }`
          }
        >
          {h.label}
        </button>
      ))}
    </div>
  )
}
