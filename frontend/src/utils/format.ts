export function fmt(n: number | null | undefined, digits = 3): string {
  return typeof n === 'number' && Number.isFinite(n) ? n.toFixed(digits) : 'n/a'
}

export function formatArea(km2: number | null | undefined, unit: 'km2' | 'ha' = 'km2'): string {
  if (typeof km2 !== 'number' || !Number.isFinite(km2)) return 'n/a'
  return unit === 'ha' ? `${(km2 * 100).toFixed(1)} ha` : `${km2.toFixed(3)} km²`
}

export function formatPower(dbVal: number | null | undefined, unit: 'db' | 'linear' = 'db'): string {
  if (typeof dbVal !== 'number' || !Number.isFinite(dbVal)) return 'n/a'
  if (unit === 'linear') {
    const lin = 10 ** (dbVal / 10)
    return `${lin.toFixed(3)}×`
  }
  return `${dbVal.toFixed(3)} dB`
}

export function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} hours ago`
  return `${Math.floor(s / 86400)} days ago`
}

export function downloadFile(name: string, text: string, type: string): void {
  const blob = new Blob([text], { type })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 5000)
}
