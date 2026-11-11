import { useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Activity,
  ArrowUpRight,
  Bell,
  Building2,
  Camera,
  Check,
  Mail,
  MapPin,
  RotateCcw,
  ShieldCheck,
  Trash2,
  Upload,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { fetchAois } from '../api/aois'
import { fetchAuthStatus } from '../api/auth'
import { fetchAlerts, fetchWatchlist } from '../api/watchlist'
import { Card } from '../components/Card'
import { SevBadge } from '../components/SevBadge'
import { UserAvatar } from '../components/UserAvatar'
import { useBackendStatus } from '../hooks/useBackendStatus'
import { useJobs } from '../hooks/useJobs'
import { DEFAULT_PROFILE, usePrefsStore, type AvatarKind } from '../store/usePrefsStore'
import {
  AVATAR_PRESETS,
  AVATAR_TONE_LIST,
  computeInitials,
  getAvatarPresetMeta,
  resizeImageToAvatarDataUrl,
} from '../utils/avatar'
import { formatArea, timeAgo } from '../utils/format'
import { HAZARDS, REGIONS, hazardLabel, regionName } from '../utils/geo'
import { severityOf } from '../utils/severity'

export default function Profile() {
  const navigate = useNavigate()
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const profile = usePrefsStore((s) => s.profile)
  const setProfile = usePrefsStore((s) => s.setProfile)
  const resetProfile = usePrefsStore((s) => s.resetProfile)
  const prefs = usePrefsStore((s) => s.prefs)
  const setPrefs = usePrefsStore((s) => s.setPrefs)

  const [displayName, setDisplayName] = useState(profile.displayName)
  const [role, setRole] = useState(profile.role)
  const [organization, setOrganization] = useState(profile.organization)
  const [email, setEmail] = useState(profile.email)
  const [bio, setBio] = useState(profile.bio)
  const [customInitials, setCustomInitials] = useState(profile.avatarCustomInitials)
  const [uploading, setUploading] = useState(false)

  const backendOk = useBackendStatus()
  const { jobs } = useJobs(30000)

  const authQuery = useQuery({
    queryKey: ['auth-status'],
    queryFn: fetchAuthStatus,
    staleTime: 60000,
    retry: 0,
  })
  const aoisQuery = useQuery({
    queryKey: ['aois'],
    queryFn: fetchAois,
    staleTime: 60000,
    retry: 0,
  })
  const watchlistQuery = useQuery({
    queryKey: ['watchlist'],
    queryFn: fetchWatchlist,
    staleTime: 60000,
    retry: 0,
  })
  const alertsQuery = useQuery({
    queryKey: ['db-alerts'],
    queryFn: fetchAlerts,
    staleTime: 30000,
    retry: 0,
  })

  const activeName = displayName.trim() || 'Researcher'
  const previewProfile = {
    ...profile,
    displayName: activeName,
    role: role.trim() || DEFAULT_PROFILE.role,
    organization: organization.trim(),
    avatarCustomInitials: customInitials,
  }
  const initialsPreview = computeInitials(activeName, customInitials)

  const dirty =
    displayName !== profile.displayName ||
    role !== profile.role ||
    organization !== profile.organization ||
    email !== profile.email ||
    bio !== profile.bio ||
    customInitials !== profile.avatarCustomInitials

  const saveDetails = (e: FormEvent) => {
    e.preventDefault()
    const cleanName = displayName.trim() || DEFAULT_PROFILE.displayName
    const cleanRole = role.trim() || DEFAULT_PROFILE.role
    const cleanInitials = customInitials.replace(/\s+/g, '').toUpperCase().slice(0, 2)
    setDisplayName(cleanName)
    setRole(cleanRole)
    setCustomInitials(cleanInitials)
    setProfile({
      displayName: cleanName,
      role: cleanRole,
      organization: organization.trim(),
      email: email.trim(),
      bio: bio.trim(),
      avatarCustomInitials: cleanInitials,
    })
    toast.success('Operator profile saved')
  }

  const discardEdits = () => {
    setDisplayName(profile.displayName)
    setRole(profile.role)
    setOrganization(profile.organization)
    setEmail(profile.email)
    setBio(profile.bio)
    setCustomInitials(profile.avatarCustomInitials)
  }

  const handleResetAll = () => {
    resetProfile()
    setDisplayName(DEFAULT_PROFILE.displayName)
    setRole(DEFAULT_PROFILE.role)
    setOrganization(DEFAULT_PROFILE.organization)
    setEmail(DEFAULT_PROFILE.email)
    setBio(DEFAULT_PROFILE.bio)
    setCustomInitials(DEFAULT_PROFILE.avatarCustomInitials)
    toast.success('Profile reset to defaults')
  }

  const selectAvatarKind = (kind: AvatarKind) => {
    if (kind === 'photo' && !profile.avatarPhotoDataUrl) {
      fileInputRef.current?.click()
      return
    }
    setProfile({ avatarKind: kind })
  }

  const handlePhotoUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploading(true)
    try {
      const dataUrl = await resizeImageToAvatarDataUrl(file, 192)
      setProfile({
        avatarKind: 'photo',
        avatarPhotoDataUrl: dataUrl,
      })
      toast.success('Custom avatar photo updated')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to upload image')
    } finally {
      setUploading(false)
    }
  }

  const removePhoto = () => {
    setProfile({
      avatarPhotoDataUrl: null,
      avatarKind: profile.avatarKind === 'photo' ? 'initials' : profile.avatarKind,
    })
    toast.success('Custom photo removed')
  }

  const recentJobs = jobs
    .slice()
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, 5)
  const completedJobs = jobs.filter((j) => j.status === 'complete')
  const aois = aoisQuery.data ?? []
  const watchlist = watchlistQuery.data ?? []
  const alerts = alertsQuery.data ?? []
  const unreadAlerts = alerts.filter((a) => !a.acknowledged)

  const activePresetMeta = getAvatarPresetMeta(profile.avatarPreset)

  return (
    <div className="space-y-5 max-w-6xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Operator Profile</h1>
          <p className="text-xs text-white/55">
            Customize your profile identity, choose your TerraPulse avatar, and inspect live workspace activity.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => navigate('/settings')}
            className="text-sm rounded-lg border border-white/15 bg-white/5 hover:bg-white/10 px-3 py-1.5 cursor-pointer"
          >
            Settings &amp; Sources
          </button>
          <button
            type="button"
            onClick={() => navigate('/change')}
            className="text-sm rounded-lg bg-blue-600 hover:bg-blue-500 text-white tp-keep-white font-medium px-3 py-1.5 cursor-pointer"
          >
            New Analysis
          </button>
        </div>
      </div>

      <section className="tp-card rounded-2xl border border-white/10 bg-gradient-to-br from-[#0b1b33] via-[#0a1226] to-[#060b16] p-6 flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="flex items-start sm:items-center gap-4">
          <div className="relative shrink-0">
            <UserAvatar profile={previewProfile} size="xl" />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              title="Upload custom avatar photo"
              aria-label="Upload custom avatar photo"
              className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-blue-600 hover:bg-blue-500 text-white tp-keep-white border border-white/25 flex items-center justify-center shadow-md cursor-pointer"
            >
              <Camera size={13} />
            </button>
          </div>
          <div className="space-y-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-bold text-white truncate">{activeName}</h2>
              <span className="text-[11px] rounded-full bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 px-2 py-0.5">
                {profile.avatarKind === 'photo'
                  ? 'Photo Avatar'
                  : profile.avatarKind === 'preset'
                    ? activePresetMeta.label
                    : `Monogram (${initialsPreview})`}
              </span>
            </div>
            <p className="text-sm text-white/75">{role.trim() || DEFAULT_PROFILE.role}</p>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-white/55 pt-0.5">
              {organization.trim() && (
                <span className="flex items-center gap-1">
                  <Building2 size={12} />
                  {organization.trim()}
                </span>
              )}
              {email.trim() && (
                <span className="flex items-center gap-1">
                  <Mail size={12} />
                  {email.trim()}
                </span>
              )}
              {profile.updatedAt && (
                <span>Updated {timeAgo(profile.updatedAt)}</span>
              )}
            </div>
            {bio.trim() && <p className="text-xs text-white/65 pt-1 max-w-2xl">{bio.trim()}</p>}
          </div>
        </div>

        <div className="flex flex-col items-start md:items-end gap-2 shrink-0">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`text-xs px-2.5 py-1 rounded-full border ${
                backendOk === false
                  ? 'bg-red-500/15 text-red-300 border-red-500/30'
                  : backendOk
                    ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                    : 'bg-white/10 text-white/65 border-white/15'
              }`}
            >
              {backendOk ? 'API Connected' : backendOk === false ? 'API Offline' : 'Checking API…'}
            </span>
            <span
              className={`text-xs px-2.5 py-1 rounded-full border ${
                authQuery.data?.connected
                  ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                  : authQuery.data
                    ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                    : 'bg-white/10 text-white/65 border-white/15'
              }`}
            >
              {authQuery.data?.connected
                ? 'Earthdata Connected'
                : authQuery.isFetching
                  ? 'Verifying Earthdata…'
                  : 'Earthdata Unverified'}
            </span>
          </div>
          <button
            type="button"
            onClick={() => void authQuery.refetch()}
            disabled={authQuery.isFetching}
            className="text-xs text-cyan-300 hover:underline disabled:opacity-50 cursor-pointer"
          >
            {authQuery.isFetching ? 'Checking Earthdata status…' : 'Verify Earthdata connection'}
          </button>
        </div>
      </section>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-[#0c1424] rounded-xl border border-white/10 p-4">
          <div className="flex items-center justify-between text-xs text-white/55">
            <span>Analyses Run</span>
            <Activity size={14} className="text-cyan-400" />
          </div>
          <div className="text-2xl font-bold mt-1">{jobs.length}</div>
          <div className="text-[11px] text-white/50">{completedJobs.length} completed</div>
        </div>
        <div className="bg-[#0c1424] rounded-xl border border-white/10 p-4">
          <div className="flex items-center justify-between text-xs text-white/55">
            <span>Saved AOIs</span>
            <MapPin size={14} className="text-emerald-400" />
          </div>
          <div className="text-2xl font-bold mt-1">{aois.length}</div>
          <div className="text-[11px] text-white/50">polygons in SQLite</div>
        </div>
        <div className="bg-[#0c1424] rounded-xl border border-white/10 p-4">
          <div className="flex items-center justify-between text-xs text-white/55">
            <span>Watchlist Sites</span>
            <ShieldCheck size={14} className="text-blue-400" />
          </div>
          <div className="text-2xl font-bold mt-1">{watchlist.length}</div>
          <div className="text-[11px] text-white/50">monitored coordinates</div>
        </div>
        <div className="bg-[#0c1424] rounded-xl border border-white/10 p-4">
          <div className="flex items-center justify-between text-xs text-white/55">
            <span>Unread Alerts</span>
            <Bell size={14} className="text-amber-400" />
          </div>
          <div className="text-2xl font-bold mt-1">{unreadAlerts.length}</div>
          <div className="text-[11px] text-white/50">{alerts.length} total logged</div>
        </div>
      </div>

      <div className="grid lg:grid-cols-12 gap-5">
        <div className="lg:col-span-7 space-y-5">
          <Card title="Avatar Choice &amp; Visual Identity">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              onChange={(e) => void handlePhotoUpload(e)}
              className="hidden"
              aria-label="Upload custom avatar image"
            />

            <div className="flex flex-wrap gap-2 pb-2">
              {[
                { id: 'preset' as const, label: 'Icon Avatars' },
                { id: 'initials' as const, label: 'Initials Monogram' },
                { id: 'photo' as const, label: 'Custom Photo' },
              ].map((tabItem) => (
                <button
                  key={tabItem.id}
                  type="button"
                  onClick={() => selectAvatarKind(tabItem.id)}
                  className={`text-xs rounded-lg px-3.5 py-1.5 font-medium transition-colors cursor-pointer ${
                    profile.avatarKind === tabItem.id
                      ? 'bg-blue-600 text-white tp-keep-white'
                      : 'bg-white/5 text-white/70 hover:bg-white/10'
                  }`}
                >
                  {tabItem.label}
                </button>
              ))}
            </div>

            {profile.avatarKind === 'preset' && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-1">
                {AVATAR_PRESETS.map((preset) => {
                  const Icon = preset.icon
                  const selected = profile.avatarPreset === preset.id
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => setProfile({ avatarKind: 'preset', avatarPreset: preset.id })}
                      className={`relative rounded-xl border p-3 text-left transition-all cursor-pointer ${
                        selected
                          ? 'border-cyan-400 bg-cyan-500/10 ring-1 ring-cyan-400/50'
                          : 'border-white/10 bg-white/5 hover:border-white/25'
                      }`}
                    >
                      {selected && (
                        <span className="absolute top-2 right-2 w-4 h-4 rounded-full bg-cyan-500 text-white tp-keep-white flex items-center justify-center">
                          <Check size={10} />
                        </span>
                      )}
                      <span className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center mb-2 text-cyan-300">
                        <Icon size={18} />
                      </span>
                      <div className="text-xs font-semibold text-white">{preset.label}</div>
                      <div className="text-[11px] text-white/50">{preset.subtitle}</div>
                    </button>
                  )
                })}
              </div>
            )}

            {profile.avatarKind === 'initials' && (
              <div className="rounded-xl border border-white/10 bg-white/5 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <UserAvatar profile={previewProfile} size="lg" />
                  <div>
                    <div className="text-sm font-semibold text-white">Monogram: {initialsPreview}</div>
                    <div className="text-xs text-white/55">
                      Automatically derived from your display name, or override below.
                    </div>
                  </div>
                </div>
                <label className="text-xs space-y-1">
                  <span className="block text-white/60">Custom initials (optional)</span>
                  <input
                    value={customInitials}
                    maxLength={2}
                    onChange={(e) => {
                      const val = e.target.value.toUpperCase()
                      setCustomInitials(val)
                      setProfile({ avatarKind: 'initials', avatarCustomInitials: val })
                    }}
                    placeholder={computeInitials(activeName)}
                    className="w-24 bg-[#060b16] border border-white/15 rounded-lg px-2.5 py-1.5 text-sm text-center font-bold uppercase text-white"
                  />
                </label>
              </div>
            )}

            {profile.avatarKind === 'photo' && (
              <div className="rounded-xl border border-white/10 bg-white/5 p-4 flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <UserAvatar profile={previewProfile} size="lg" />
                  <div className="space-y-0.5">
                    <div className="text-sm font-semibold text-white">Custom Profile Image</div>
                    <div className="text-xs text-white/55">
                      PNG, JPG, WebP, or GIF · square-cropped locally to 192×192 and stored only in this browser.
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={uploading}
                    onClick={() => fileInputRef.current?.click()}
                    className="text-xs rounded-lg bg-blue-600 hover:bg-blue-500 text-white tp-keep-white px-3 py-1.5 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    <Upload size={13} />
                    {uploading ? 'Processing…' : profile.avatarPhotoDataUrl ? 'Replace Photo' : 'Choose Photo'}
                  </button>
                  {profile.avatarPhotoDataUrl && (
                    <button
                      type="button"
                      onClick={removePhoto}
                      className="text-xs rounded-lg border border-red-500/35 text-red-300 hover:bg-red-500/10 px-3 py-1.5 flex items-center gap-1.5 cursor-pointer"
                    >
                      <Trash2 size={13} />
                      Remove
                    </button>
                  )}
                </div>
              </div>
            )}

            <div className="pt-3 border-t border-white/10 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-white/75 font-medium">Badge Accent Color</span>
                <span className="text-white/50">
                  {AVATAR_TONE_LIST.find((t) => t.id === profile.avatarTone)?.label ?? 'Ocean Blue'}
                </span>
              </div>
              <div className="flex flex-wrap gap-2.5">
                {AVATAR_TONE_LIST.map((tone) => {
                  const selected = profile.avatarTone === tone.id
                  return (
                    <button
                      key={tone.id}
                      type="button"
                      onClick={() => setProfile({ avatarTone: tone.id })}
                      aria-label={`Select ${tone.label} avatar color`}
                      className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs transition-all cursor-pointer ${
                        selected
                          ? 'border-cyan-400 bg-white/10 text-white'
                          : 'border-white/10 bg-white/5 text-white/70 hover:border-white/25'
                      }`}
                    >
                      <span className={`w-4 h-4 rounded-full ${tone.swatchClass} ring-1 ring-white/30`} />
                      <span>{tone.label}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          </Card>

          <Card title="Operator Details">
            <form onSubmit={saveDetails} className="space-y-3">
              <div className="grid sm:grid-cols-2 gap-3">
                <label className="block text-xs space-y-1">
                  <span className="text-white/70">Display Name</span>
                  <input
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Researcher"
                    maxLength={60}
                    className="w-full bg-[#060b16] border border-white/15 rounded-lg px-3 py-2 text-sm text-white"
                  />
                </label>
                <label className="block text-xs space-y-1">
                  <span className="text-white/70">Role / Title</span>
                  <input
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                    placeholder="SAR Earth Observation Analyst"
                    maxLength={80}
                    className="w-full bg-[#060b16] border border-white/15 rounded-lg px-3 py-2 text-sm text-white"
                  />
                </label>
                <label className="block text-xs space-y-1">
                  <span className="text-white/70">Organization / Lab</span>
                  <input
                    value={organization}
                    onChange={(e) => setOrganization(e.target.value)}
                    placeholder="TerraPulse Workspace"
                    maxLength={80}
                    className="w-full bg-[#060b16] border border-white/15 rounded-lg px-3 py-2 text-sm text-white"
                  />
                </label>
                <label className="block text-xs space-y-1">
                  <span className="text-white/70">Alert Notification Email (optional)</span>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Used to pre-fill watchlist monitors"
                    maxLength={120}
                    className="w-full bg-[#060b16] border border-white/15 rounded-lg px-3 py-2 text-sm text-white"
                  />
                </label>
              </div>

              <label className="block text-xs space-y-1">
                <span className="text-white/70">Research Focus / Notes</span>
                <textarea
                  rows={2}
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  placeholder="e.g. Flood inundation and coastal deformation analysis using NISAR L-band GCOV & GUNW."
                  maxLength={240}
                  className="w-full bg-[#060b16] border border-white/15 rounded-lg px-3 py-2 text-sm text-white resize-none"
                />
              </label>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <div className="flex flex-wrap gap-2">
                  <button
                    type="submit"
                    className="rounded-lg bg-blue-600 hover:bg-blue-500 text-white tp-keep-white text-sm font-medium px-4 py-1.5 cursor-pointer"
                  >
                    Save Profile
                  </button>
                  {dirty && (
                    <button
                      type="button"
                      onClick={discardEdits}
                      className="rounded-lg border border-white/15 bg-white/5 hover:bg-white/10 text-sm px-3 py-1.5 cursor-pointer"
                    >
                      Discard
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  onClick={handleResetAll}
                  className="text-xs text-white/55 hover:text-white flex items-center gap-1 cursor-pointer"
                >
                  <RotateCcw size={12} />
                  Reset to defaults
                </button>
              </div>
              <p className="text-[11px] text-white/45">
                Profile and avatar preferences stay in this browser (`localStorage`). Earthdata credentials stay strictly in `backend/.env`.
              </p>
            </form>
          </Card>
        </div>

        <div className="lg:col-span-5 space-y-5">
          <Card
            title="Workspace Defaults"
            action={
              <button
                type="button"
                onClick={() => navigate('/settings?tab=preferences')}
                className="text-xs text-cyan-300 hover:underline flex items-center gap-1 cursor-pointer"
              >
                All Settings
                <ArrowUpRight size={12} />
              </button>
            }
          >
            <div className="space-y-2.5 text-xs">
              <label className="flex items-center justify-between gap-3">
                <span>Theme</span>
                <select
                  value={prefs.theme}
                  onChange={(e) => setPrefs({ theme: e.target.value === 'light' ? 'light' : 'dark' })}
                  className="bg-white/10 rounded px-2 py-1"
                >
                  <option value="dark">Dark Slate</option>
                  <option value="light">Light High-Contrast</option>
                </select>
              </label>
              <label className="flex items-center justify-between gap-3">
                <span>Default hazard</span>
                <select
                  value={prefs.defaultHazard}
                  onChange={(e) => setPrefs({ defaultHazard: e.target.value })}
                  className="bg-white/10 rounded px-2 py-1"
                >
                  {HAZARDS.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center justify-between gap-3">
                <span>Default region</span>
                <select
                  value={prefs.defaultRegion}
                  onChange={(e) => setPrefs({ defaultRegion: e.target.value })}
                  className="bg-white/10 rounded px-2 py-1"
                >
                  {REGIONS.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center justify-between gap-3">
                <span>Area &amp; backscatter units</span>
                <div className="flex gap-1.5">
                  <select
                    aria-label="Area unit"
                    value={prefs.areaUnit}
                    onChange={(e) => setPrefs({ areaUnit: e.target.value === 'ha' ? 'ha' : 'km2' })}
                    className="bg-white/10 rounded px-2 py-1"
                  >
                    <option value="km2">km²</option>
                    <option value="ha">ha</option>
                  </select>
                  <select
                    aria-label="Backscatter unit"
                    value={prefs.powerUnit}
                    onChange={(e) => setPrefs({ powerUnit: e.target.value === 'linear' ? 'linear' : 'db' })}
                    className="bg-white/10 rounded px-2 py-1"
                  >
                    <option value="db">dB</option>
                    <option value="linear">Linear</option>
                  </select>
                </div>
              </label>
            </div>
          </Card>

          <Card
            title="Recent Analyses"
            action={
              <button
                type="button"
                onClick={() => navigate('/reports')}
                className="text-xs text-cyan-300 hover:underline flex items-center gap-1 cursor-pointer"
              >
                Reports
                <ArrowUpRight size={12} />
              </button>
            }
          >
            {recentJobs.length === 0 ? (
              <div className="text-xs space-y-2 py-1">
                <p>No NISAR analysis runs recorded yet in this workspace.</p>
                <button
                  type="button"
                  onClick={() => navigate('/change')}
                  className="text-cyan-300 hover:underline cursor-pointer"
                >
                  Run your first surface-change analysis →
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {recentJobs.map((job) => (
                  <button
                    key={job.job_id}
                    type="button"
                    onClick={() => navigate(`/results/${job.job_id}`)}
                    className="w-full rounded-lg border border-white/10 bg-white/5 hover:border-cyan-400/50 px-3 py-2 text-left flex items-center justify-between gap-2 transition-colors cursor-pointer"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-white truncate">
                        {hazardLabel(job.hazard)} · {regionName(job.location.lat, job.location.lon)}
                      </div>
                      <div className="text-[11px] text-white/50">
                        {job.status === 'complete'
                          ? `${formatArea(job.affected_area_km2, prefs.areaUnit)} · ${timeAgo(job.created_at)}`
                          : `${job.status} · ${timeAgo(job.created_at)}`}
                      </div>
                    </div>
                    {job.status === 'complete' ? (
                      <SevBadge level={severityOf(job)} />
                    ) : (
                      <span className="text-[11px] px-2 py-0.5 rounded bg-white/10 text-white/70">
                        {job.status}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </Card>

          <Card title="Earthdata Credentials &amp; Security">
            <p className="text-xs">
              NASA Earthdata Login credentials remain strictly on the server in{' '}
              <span className="font-mono text-white">backend/.env</span> and are never exposed to browser storage.
            </p>
            <div className="flex flex-wrap gap-3 pt-1 text-xs">
              <button
                type="button"
                onClick={() => navigate('/settings?tab=sources')}
                className="text-cyan-300 hover:underline cursor-pointer"
              >
                Data Sources →
              </button>
              <button
                type="button"
                onClick={() => navigate('/alerts')}
                className="text-cyan-300 hover:underline cursor-pointer"
              >
                Watchlist &amp; Alerts →
              </button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}
