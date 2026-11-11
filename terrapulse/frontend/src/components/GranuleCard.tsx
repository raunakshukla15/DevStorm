import type { Granule } from '../types/api'

export function GranuleCard({ label, granule }: { label: string; granule?: Granule | null }) {
  if (!granule) return null
  return (
    <div className="border border-white/10 rounded-lg p-3 space-y-1">
      <p className="font-semibold text-white text-sm">{label}</p>
      <p className="break-all text-xs">{granule.title}</p>
      <p className="text-xs">
        Acquired {granule.acquisition_date ?? 'unknown'} · {granule.short_name} · orbit{' '}
        {granule.orbit_direction ?? 'unknown'}
      </p>
      {granule.https_url && (
        <p className="text-xs break-all">
          File:{' '}
          <a className="text-cyan-300 underline" href={granule.https_url} target="_blank" rel="noreferrer">
            download
          </a>
        </p>
      )}
    </div>
  )
}
