import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ChevronRight,
  Database,
  Moon,
  SlidersHorizontal,
  Sparkles,
  Sun,
  UserCircle2,
} from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import { fetchAois } from '../api/aois'
import { fetchAuthStatus } from '../api/auth'
import { fetchAlerts } from '../api/watchlist'
import { useBackendStatus } from '../hooks/useBackendStatus'
import { useJobs } from '../hooks/useJobs'
import { usePrefsStore } from '../store/usePrefsStore'
import { AVATAR_PRESETS, AVATAR_TONE_LIST, computeInitials } from '../utils/avatar'
import { UserAvatar } from './UserAvatar'

const QUICK_PRESET_IDS = ['satellite', 'globe', 'radar', 'waves', 'compass'] as const

export function ProfileMenu() {
  const [openPath, setOpenPath] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const navigate = useNavigate()
  const location = useLocation()
  const open = openPath === location.pathname

  const profile = usePrefsStore((s) => s.profile)
  const setProfile = usePrefsStore((s) => s.setProfile)
  const theme = usePrefsStore((s) => s.prefs.theme)
  const setPrefs = usePrefsStore((s) => s.setPrefs)

  const backendOk = useBackendStatus()
  const { jobs } = useJobs(30000)

  const authQuery = useQuery({
    queryKey: ['auth-status'],
    queryFn: fetchAuthStatus,
    staleTime: 60000,
    retry: 0,
    enabled: open,
  })

  const aoisQuery = useQuery({
    queryKey: ['aois'],
    queryFn: fetchAois,
    staleTime: 60000,
    retry: 0,
    enabled: open,
  })

  const alertsQuery = useQuery({
    queryKey: ['db-alerts'],
    queryFn: fetchAlerts,
    staleTime: 30000,
    retry: 0,
    enabled: open,
  })

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpenPath(null)
      }
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpenPath(null)
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const displayName = profile.displayName.trim() || 'Researcher'
  const initials = computeInitials(displayName, profile.avatarCustomInitials)
  const completedCount = jobs.filter((j) => j.status === 'complete').length
  const aoiCount = aoisQuery.data?.length ?? 0
  const unreadAlertsCount = (alertsQuery.data ?? []).filter((a) => !a.acknowledged).length

  const goTo = (to: string) => {
    setOpenPath(null)
    navigate(to)
  }

  const earthdataBadge =
    backendOk === false
      ? { text: 'Backend Offline', cls: 'bg-red-500/15 text-red-300 border-red-500/30' }
      : authQuery.data?.connected
        ? { text: 'Earthdata Connected', cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' }
        : authQuery.data && !authQuery.data.connected
          ? { text: 'Earthdata Auth Required', cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30' }
          : backendOk
            ? { text: 'API Connected', cls: 'bg-sky-500/15 text-sky-300 border-sky-500/30' }
            : { text: 'Connecting…', cls: 'bg-white/10 text-white/65 border-white/15' }

  const quickPresets = AVATAR_PRESETS.filter((p) =>
    (QUICK_PRESET_IDS as readonly string[]).includes(p.id),
  )

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpenPath((prev) => (prev === location.pathname ? null : location.pathname))}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Operator profile menu (${displayName})`}
        title={`${displayName} — Open profile & avatar options`}
        className={`rounded-full p-0.5 transition-all cursor-pointer focus-visible:outline-2 focus-visible:outline-cyan-400 ${
          open ? 'ring-2 ring-cyan-400' : 'hover:ring-2 hover:ring-cyan-400/60'
        }`}
      >
        <UserAvatar profile={profile} size="sm" />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Operator profile menu"
          className="absolute right-0 mt-2 w-80 sm:w-[22rem] rounded-xl bg-[#0c1424] border border-white/15 shadow-2xl z-50 overflow-hidden"
        >
          <div className="p-4 border-b border-white/10 space-y-3">
            <div className="flex items-start gap-3">
              <UserAvatar profile={profile} size="lg" />
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-sm text-white truncate">{displayName}</div>
                <div className="text-xs text-white/65 truncate">
                  {profile.role.trim() || 'SAR Earth Observation Analyst'}
                </div>
                {profile.organization.trim() && (
                  <div className="text-[11px] text-white/45 truncate mt-0.5">
                    {profile.organization.trim()}
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between gap-2">
              <span className={`text-[11px] px-2 py-0.5 rounded-full border ${earthdataBadge.cls}`}>
                {earthdataBadge.text}
              </span>
              <button
                type="button"
                onClick={() => goTo('/profile')}
                className="text-xs text-cyan-300 hover:underline flex items-center gap-1 cursor-pointer"
              >
                Full Profile
                <ChevronRight size={12} />
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2 pt-0.5">
              <button
                type="button"
                onClick={() => goTo('/')}
                className="rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 px-2 py-1.5 text-left transition-colors cursor-pointer"
              >
                <div className="text-xs font-semibold text-white">
                  {completedCount}/{jobs.length}
                </div>
                <div className="text-[10px] text-white/50">Analyses</div>
              </button>
              <button
                type="button"
                onClick={() => goTo('/explore')}
                className="rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 px-2 py-1.5 text-left transition-colors cursor-pointer"
              >
                <div className="text-xs font-semibold text-white">
                  {aoisQuery.isLoading ? '…' : aoiCount}
                </div>
                <div className="text-[10px] text-white/50">Saved AOIs</div>
              </button>
              <button
                type="button"
                onClick={() => goTo('/alerts')}
                className="rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 px-2 py-1.5 text-left transition-colors cursor-pointer"
              >
                <div className="text-xs font-semibold text-white">
                  {alertsQuery.isLoading ? '…' : unreadAlertsCount}
                </div>
                <div className="text-[10px] text-white/50">Unread Alerts</div>
              </button>
            </div>
          </div>

          <div className="p-4 border-b border-white/10 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-white/75 flex items-center gap-1.5">
                <Sparkles size={13} className="text-cyan-400" />
                Quick Avatar Choice
              </span>
              <button
                type="button"
                onClick={() => goTo('/profile')}
                className="text-[11px] text-cyan-300 hover:underline cursor-pointer"
              >
                Upload / All Icons
              </button>
            </div>

            <div className="flex items-center gap-1.5 flex-wrap">
              <button
                type="button"
                onClick={() => setProfile({ avatarKind: 'initials' })}
                title={`Monogram (${initials})`}
                aria-label={`Use initials avatar (${initials})`}
                className={`w-8 h-8 rounded-full text-xs font-bold flex items-center justify-center border transition-all cursor-pointer ${
                  profile.avatarKind === 'initials'
                    ? 'border-cyan-400 ring-2 ring-cyan-400/50 bg-blue-600/30 text-white'
                    : 'border-white/15 bg-white/5 text-white/75 hover:border-white/35'
                }`}
              >
                {initials}
              </button>

              {quickPresets.map((preset) => {
                const Icon = preset.icon
                const active = profile.avatarKind === 'preset' && profile.avatarPreset === preset.id
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => setProfile({ avatarKind: 'preset', avatarPreset: preset.id })}
                    title={preset.label}
                    aria-label={`Choose ${preset.label} avatar`}
                    className={`w-8 h-8 rounded-full flex items-center justify-center border transition-all cursor-pointer ${
                      active
                        ? 'border-cyan-400 ring-2 ring-cyan-400/50 bg-blue-600/30 text-white'
                        : 'border-white/15 bg-white/5 text-white/75 hover:border-white/35'
                    }`}
                  >
                    <Icon size={15} />
                  </button>
                )
              })}

              {profile.avatarPhotoDataUrl && (
                <button
                  type="button"
                  onClick={() => setProfile({ avatarKind: 'photo' })}
                  title="Use uploaded photo"
                  aria-label="Use uploaded photo avatar"
                  className={`w-8 h-8 rounded-full overflow-hidden border transition-all cursor-pointer ${
                    profile.avatarKind === 'photo'
                      ? 'border-cyan-400 ring-2 ring-cyan-400/50'
                      : 'border-white/15 hover:border-white/35'
                  }`}
                >
                  <img
                    src={profile.avatarPhotoDataUrl}
                    alt="Uploaded avatar"
                    className="w-full h-full object-cover"
                  />
                </button>
              )}
            </div>

            <div className="flex items-center justify-between pt-1">
              <span className="text-[11px] text-white/50">Badge color</span>
              <div className="flex items-center gap-1.5">
                {AVATAR_TONE_LIST.map((tone) => {
                  const selected = profile.avatarTone === tone.id
                  return (
                    <button
                      key={tone.id}
                      type="button"
                      onClick={() => setProfile({ avatarTone: tone.id })}
                      title={tone.label}
                      aria-label={`Select ${tone.label} badge tone`}
                      className={`w-4 h-4 rounded-full ${tone.swatchClass} transition-transform cursor-pointer ${
                        selected ? 'ring-2 ring-white scale-110' : 'opacity-75 hover:opacity-100'
                      }`}
                    />
                  )
                })}
              </div>
            </div>
          </div>

          <div className="p-2 space-y-1">
            <button
              type="button"
              onClick={() => goTo('/profile')}
              className="w-full flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm bg-blue-600 hover:bg-blue-500 text-white tp-keep-white font-medium transition-colors cursor-pointer"
            >
              <span className="flex items-center gap-2">
                <UserCircle2 size={16} />
                View &amp; Edit Profile
              </span>
              <ChevronRight size={14} />
            </button>

            <button
              type="button"
              onClick={() => setPrefs({ theme: theme === 'dark' ? 'light' : 'dark' })}
              className="w-full flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs text-white/75 hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
            >
              <span className="flex items-center gap-2">
                {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
                Switch to {theme === 'dark' ? 'Light High-Contrast' : 'Dark Slate'} Theme
              </span>
              <span className="text-[10px] uppercase tracking-wider text-white/45">
                {theme}
              </span>
            </button>

            <button
              type="button"
              onClick={() => goTo('/settings?tab=account')}
              className="w-full flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs text-white/75 hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
            >
              <span className="flex items-center gap-2">
                <Database size={14} />
                Earthdata Account &amp; Data Sources
              </span>
              <ChevronRight size={13} className="text-white/40" />
            </button>

            <button
              type="button"
              onClick={() => goTo('/settings?tab=preferences')}
              className="w-full flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs text-white/75 hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
            >
              <span className="flex items-center gap-2">
                <SlidersHorizontal size={14} />
                Workspace &amp; Scientific Units
              </span>
              <ChevronRight size={13} className="text-white/40" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
