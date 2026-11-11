import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { AnalysisResult } from '../types/api'

export type AvatarKind = 'initials' | 'preset' | 'photo'

export type AvatarPresetId =
  | 'satellite'
  | 'globe'
  | 'radar'
  | 'waves'
  | 'compass'
  | 'mountain'
  | 'flame'
  | 'shield'

export type AvatarToneId =
  | 'ocean'
  | 'cyan'
  | 'emerald'
  | 'amber'
  | 'violet'
  | 'slate'

export interface OperatorProfile {
  displayName: string
  role: string
  organization: string
  email: string
  bio: string
  avatarKind: AvatarKind
  avatarPreset: AvatarPresetId
  avatarTone: AvatarToneId
  avatarCustomInitials: string
  avatarPhotoDataUrl: string | null
  updatedAt: string
}

export interface UserPrefs {
  defaultHazard: string
  autoDates: boolean
  defaultRegion: string
  baseLayer: 'esri' | 'osm'
  theme: 'dark' | 'light'
  areaUnit: 'km2' | 'ha'
  powerUnit: 'db' | 'linear'
}

interface PrefsState {
  prefs: UserPrefs
  profile: OperatorProfile
  viewedIds: string[]
  lastResult: AnalysisResult | null
  activeJobId: string | null
  activeJobStartedAt: number | null
  setPrefs: (next: Partial<UserPrefs>) => void
  setProfile: (next: Partial<OperatorProfile>) => void
  resetProfile: () => void
  markViewed: (jobId: string) => void
  setLastResult: (result: AnalysisResult | null) => void
  setActiveJob: (jobId: string | null, startedAt?: number | null) => void
}

export const DEFAULT_PREFS: UserPrefs = {
  defaultHazard: 'flood',
  autoDates: true,
  defaultRegion: 'amazon',
  baseLayer: 'esri',
  theme: 'dark',
  areaUnit: 'km2',
  powerUnit: 'db',
}

export const DEFAULT_PROFILE: OperatorProfile = {
  displayName: 'Researcher',
  role: 'SAR Earth Observation Analyst',
  organization: 'TerraPulse Workspace',
  email: '',
  bio: '',
  avatarKind: 'initials',
  avatarPreset: 'satellite',
  avatarTone: 'ocean',
  avatarCustomInitials: '',
  avatarPhotoDataUrl: null,
  updatedAt: '',
}

export const usePrefsStore = create<PrefsState>()(
  persist(
    (set) => ({
      prefs: DEFAULT_PREFS,
      profile: DEFAULT_PROFILE,
      viewedIds: [],
      lastResult: null,
      activeJobId: null,
      activeJobStartedAt: null,
      setPrefs: (next) =>
        set((state) => ({
          prefs: { ...state.prefs, ...next },
        })),
      setProfile: (next) =>
        set((state) => ({
          profile: {
            ...state.profile,
            ...next,
            updatedAt: next.updatedAt ?? new Date().toISOString(),
          },
        })),
      resetProfile: () =>
        set({
          profile: {
            ...DEFAULT_PROFILE,
            updatedAt: new Date().toISOString(),
          },
        }),
      markViewed: (jobId) =>
        set((state) =>
          state.viewedIds.includes(jobId)
            ? state
            : { viewedIds: [...state.viewedIds, jobId] },
        ),
      setLastResult: (lastResult) => set({ lastResult }),
      setActiveJob: (activeJobId, startedAt) =>
        set({
          activeJobId,
          activeJobStartedAt: activeJobId ? (startedAt ?? Date.now()) : null,
        }),
    }),
    {
      name: 'terrapulse:prefs-store',
      merge: (persistedState, currentState) => {
        const persisted = (persistedState as Partial<PrefsState> | undefined) ?? {}
        const rawLast = persisted.lastResult as (AnalysisResult & { is_sample?: boolean }) | null | undefined
        const cleanLast = rawLast && !rawLast.is_sample ? rawLast : null
        return {
          ...currentState,
          ...persisted,
          lastResult: cleanLast,
          activeJobId: typeof persisted.activeJobId === 'string' ? persisted.activeJobId : null,
          activeJobStartedAt:
            typeof persisted.activeJobStartedAt === 'number' ? persisted.activeJobStartedAt : null,
          prefs: {
            ...DEFAULT_PREFS,
            ...(persisted.prefs ?? {}),
          },
          profile: {
            ...DEFAULT_PROFILE,
            ...(persisted.profile ?? {}),
          },
          viewedIds: Array.isArray(persisted.viewedIds) ? persisted.viewedIds : [],
        }
      },
    },
  ),
)
