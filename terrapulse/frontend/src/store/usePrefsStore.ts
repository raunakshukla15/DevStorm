import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { AnalysisResult } from '../types/api'

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
  viewedIds: string[]
  lastResult: AnalysisResult | null
  setPrefs: (next: Partial<UserPrefs>) => void
  markViewed: (jobId: string) => void
  setLastResult: (result: AnalysisResult | null) => void
}

const DEFAULT_PREFS: UserPrefs = {
  defaultHazard: 'flood',
  autoDates: true,
  defaultRegion: 'amazon',
  baseLayer: 'esri',
  theme: 'dark',
  areaUnit: 'km2',
  powerUnit: 'db',
}

export const usePrefsStore = create<PrefsState>()(
  persist(
    (set) => ({
      prefs: DEFAULT_PREFS,
      viewedIds: [],
      lastResult: null,
      setPrefs: (next) =>
        set((state) => ({
          prefs: { ...state.prefs, ...next },
        })),
      markViewed: (jobId) =>
        set((state) =>
          state.viewedIds.includes(jobId)
            ? state
            : { viewedIds: [...state.viewedIds, jobId] },
        ),
      setLastResult: (lastResult) => set({ lastResult }),
    }),
    {
      name: 'terrapulse:prefs-store',
    },
  ),
)
