import { useState, type FormEvent, type ReactNode } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  Activity,
  Bell,
  BookOpen,
  Database,
  FileText,
  FlaskConical,
  LayoutDashboard,
  Map as MapIcon,
  Satellite,
  Search,
  Settings as SettingsIcon,
} from 'lucide-react'
import { geocodePlace } from '../api/geocode'
import { useBackendStatus } from '../hooks/useBackendStatus'

const NAV = [
  { path: '/', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/explore', label: 'Explore Map', icon: MapIcon },
  { path: '/change', label: 'Change Analysis', icon: FlaskConical },
  { path: '/events', label: 'Event Monitoring', icon: Activity },
  { path: '/catalog', label: 'Data Catalog', icon: Database },
  { path: '/reports', label: 'Reports', icon: FileText },
  { path: '/alerts', label: 'Alerts', icon: Bell },
  { path: '/methodology', label: 'Methodology', icon: BookOpen },
  { path: '/settings', label: 'Settings', icon: SettingsIcon },
]

export function Layout({ children }: { children: ReactNode }) {
  const ok = useBackendStatus()
  const [q, setQ] = useState('')
  const navigate = useNavigate()

  const searchAll = async (e: FormEvent) => {
    e.preventDefault()
    if (!q.trim()) return
    try {
      const results = await geocodePlace(q, 1)
      if (results[0]) {
        const label = results[0].display_name.split(',').slice(0, 2).join(',')
        navigate(`/explore?lat=${results[0].lat}&lon=${results[0].lon}&label=${encodeURIComponent(label)}`)
      }
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="min-h-screen bg-[#060b16] text-white flex flex-col">
      <div className="flex flex-1 min-h-0">
        <aside className="w-60 shrink-0 border-r border-white/10 bg-[#0a1120] p-4 flex flex-col gap-1">
          <div className="flex items-center gap-2 px-2 pb-4">
            <Satellite size={20} className="text-cyan-400" />
            <span className="font-bold tracking-wide">TerraPulse</span>
          </div>
          {NAV.map((l) => (
            <NavLink
              key={l.path}
              to={l.path}
              className={({ isActive }) =>
                `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
                  isActive ? 'bg-blue-600 text-white' : 'text-white/60 hover:text-white hover:bg-white/5'
                }`
              }
            >
              <l.icon size={16} />
              {l.label}
            </NavLink>
          ))}
          <p className="mt-auto text-[11px] text-white/35 px-3 pt-3">Live NISAR data · no mock data</p>
        </aside>
        <div className="flex-1 min-w-0 flex flex-col">
          <header className="flex items-center gap-3 px-6 py-3 border-b border-white/10">
            <form
              onSubmit={searchAll}
              className="flex items-center gap-2 bg-[#0c1424] border border-white/10 rounded-lg px-3 py-1.5 w-80"
            >
              <Search size={14} className="text-white/40" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search location, region…"
                className="bg-transparent outline-none text-sm w-full"
              />
            </form>
            <div className="ml-auto flex items-center gap-3">
              <span
                className={`w-2 h-2 rounded-full ${
                  ok === null ? 'bg-amber-400' : ok ? 'bg-emerald-400' : 'bg-red-400'
                }`}
                title={ok ? 'Backend connected' : 'Backend unreachable'}
              />
              <button type="button" onClick={() => navigate('/alerts')} title="Alerts">
                <Bell size={17} className="text-white/70" />
              </button>
              <span className="w-7 h-7 rounded-full bg-white/15 flex items-center justify-center text-xs font-bold">
                R
              </span>
            </div>
          </header>
          <main className="flex-1 p-6 min-w-0 overflow-y-auto">{children}</main>
        </div>
      </div>
    </div>
  )
}
