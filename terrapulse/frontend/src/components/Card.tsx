import type { ReactNode } from 'react'

export function Card({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="tp-card bg-[#0c1424] rounded-xl border border-white/10 p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold text-white">{title}</h2>
        {action}
      </div>
      <div className="text-sm text-white/70 space-y-2">{children}</div>
    </section>
  )
}
