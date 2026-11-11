export function SevBadge({ level }: { level: string }) {
  const cls =
    level === 'High'
      ? 'bg-red-500/20 text-red-300 border-red-500/30'
      : level === 'Medium'
        ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
        : 'bg-sky-500/20 text-sky-300 border-sky-500/30'
  return <span className={`text-xs font-medium border rounded-full px-2.5 py-0.5 ${cls}`}>{level}</span>
}
