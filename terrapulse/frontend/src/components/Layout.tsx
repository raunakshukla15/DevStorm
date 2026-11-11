import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  Activity,
  Bell,
  BookOpen,
  Columns2,
  Database,
  FileText,
  FlaskConical,
  LayoutDashboard,
  LineChart as LineChartIcon,
  Map as MapIcon,
  Menu,
  Satellite,
  Search,
  Settings as SettingsIcon,
  X,
} from 'lucide-react'
import { Toaster } from 'sonner'
import { geocodePlace } from '../api/geocode'
import { useBackendStatus } from '../hooks/useBackendStatus'
import { usePrefsStore } from '../store/usePrefsStore'

const NAV = [
  { path: '/', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/explore', label: 'Explore Map', icon: MapIcon },
  { path: '/change', label: 'Change Analysis', icon: FlaskConical },
  { path: '/timeseries', label: 'Time Series', icon: LineChartIcon },
  { path: '/compare', label: 'Compare Runs', icon: Columns2 },
  { path: '/events', label: 'Event Monitoring', icon: Activity },
  { path: '/catalog', label: 'Data Catalog', icon: Database },
  { path: '/reports', label: 'Reports', icon: FileText },
  { path: '/alerts', label: 'Alerts', icon: Bell },
  { path: '/methodology', label: 'Methodology', icon: BookOpen },
  { path: '/settings', label: 'Settings', icon: SettingsIcon },
]

export function Layout({ children }: { children: ReactNode }) {
  const ok = useBackendStatus()
  const theme = usePrefsStore((s) => s.prefs.theme)
  const [q, setQ] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    document.documentElement.classList.toggle('tp-light', theme === 'light')
  }, [theme])

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
    <div className="tp-shell min-h-screen bg-[#060b16] text-white flex flex-col">
      <div className="flex flex-1 min-h-0 relative">
        <aside
          aria-label="Primary navigation"
          className={`${
            menuOpen ? 'fixed inset-y-0 left-0 z-50 flex' : 'hidden md:flex'
          } tp-sidebar w-60 shrink-0 border-r border-white/10 bg-[#0a1120] p-4 flex-col gap-1`}
        >
          <div className="flex items-center justify-between gap-2 px-2 pb-4">
            <div className="flex items-center gap-2">
              <Satellite size={20} className="text-cyan-400" />
              <span className="font-bold tracking-wide">TerraPulse</span>
            </div>
            <button
              type="button"
              onClick={() => setMenuOpen(false)}
              className="md:hidden text-white/70 p-1"
              aria-label="Close navigation menu"
            >
              <X size={18} />
            </button>
          </div>
          {NAV.map((l) => (
            <NavLink
              key={l.path}
              to={l.path}
              onClick={() => setMenuOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-cyan-400 ${
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
          <header className="flex items-center gap-3 px-4 md:px-6 py-3 border-b border-white/10">
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              className="md:hidden p-1.5 rounded-lg bg-white/5 text-white/80"
              aria-label="Open navigation menu"
            >
              <Menu size={18} />
            </button>
            <form
              onSubmit={searchAll}
              className="flex items-center gap-2 bg-[#0c1424] border border-white/10 rounded-lg px-3 py-1.5 w-60 sm:w-80"
            >
              <Search size={14} className="text-white/40" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search location, region…"
                aria-label="Search location or region"
                className="bg-transparent outline-none text-sm w-full"
              />
            </form>
            <div className="ml-auto flex items-center gap-3">
              <span
                className={`w-2 h-2 rounded-full ${
                  ok === null ? 'bg-amber-400' : ok ? 'bg-emerald-400' : 'bg-red-400'
                }`}
                title={ok ? 'Backend connected' : 'Backend unreachable'}
                aria-label={ok ? 'Backend connected' : 'Backend unreachable'}
              />
              <button type="button" onClick={() => navigate('/alerts')} title="Alerts" aria-label="Open alerts">
                <Bell size={17} className="text-white/70" />
              </button>
              <span className="w-7 h-7 rounded-full bg-white/15 flex items-center justify-center text-xs font-bold">
                R
              </span>
            </div>
          </header>
          <main className="flex-1 p-4 md:p-6 min-w-0 overflow-y-auto">{children}</main>
        </div>
      </div>
      <Toaster position="bottom-right" richColors />
    </div>
  )
}
