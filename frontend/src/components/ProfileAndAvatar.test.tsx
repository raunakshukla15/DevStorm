import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Profile from '../pages/Profile'
import Settings from '../pages/Settings'
import { DEFAULT_PREFS, DEFAULT_PROFILE, usePrefsStore } from '../store/usePrefsStore'
import { computeInitials, resizeImageToAvatarDataUrl } from '../utils/avatar'
import { ProfileMenu } from './ProfileMenu'

vi.mock('../api/auth', () => ({
  fetchHealth: vi.fn().mockResolvedValue({ status: 'healthy', service: 'terrapulse-backend' }),
  fetchAuthStatus: vi.fn().mockResolvedValue({
    connected: true,
    timestamp: '2026-11-11T10:00:00Z',
    note: 'Authenticated with NASA Earthdata.',
  }),
}))

vi.mock('../api/aois', () => ({
  fetchAois: vi.fn().mockResolvedValue([]),
}))

vi.mock('../api/watchlist', () => ({
  fetchWatchlist: vi.fn().mockResolvedValue([]),
  fetchAlerts: vi.fn().mockResolvedValue([]),
}))

vi.mock('../api/analysis', () => ({
  fetchJobs: vi.fn().mockResolvedValue([]),
}))

function renderWithProviders(ui: React.ReactElement, initialRoute = '/') {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialRoute]}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('Avatar utilities & Profile store', () => {
  beforeEach(() => {
    usePrefsStore.setState({
      prefs: { ...DEFAULT_PREFS },
      profile: { ...DEFAULT_PROFILE },
      viewedIds: [],
      lastResult: null,
    })
  })

  it('computes monogram initials cleanly', () => {
    expect(computeInitials('Researcher')).toBe('R')
    expect(computeInitials('Aarav Sharma')).toBe('AS')
    expect(computeInitials('Jane Maria Doe')).toBe('JD')
    expect(computeInitials('Jane Doe', 'tp')).toBe('TP')
    expect(computeInitials('')).toBe('TP')
  })

  it('updates and resets operator profile in store', () => {
    usePrefsStore.getState().setProfile({
      displayName: 'Meera Nair',
      avatarKind: 'preset',
      avatarPreset: 'radar',
      avatarTone: 'emerald',
    })

    const updated = usePrefsStore.getState().profile
    expect(updated.displayName).toBe('Meera Nair')
    expect(updated.avatarKind).toBe('preset')
    expect(updated.avatarPreset).toBe('radar')
    expect(updated.avatarTone).toBe('emerald')
    expect(updated.updatedAt).not.toBe('')

    usePrefsStore.getState().resetProfile()
    expect(usePrefsStore.getState().profile.displayName).toBe('Researcher')
    expect(usePrefsStore.getState().profile.avatarKind).toBe('initials')
  })

  it('rejects non-image and oversized avatar files cleanly', async () => {
    const textFile = new File(['hello'], 'notes.txt', { type: 'text/plain' })
    await expect(resizeImageToAvatarDataUrl(textFile)).rejects.toThrow(/valid image file/i)

    const bigBuffer = new Uint8Array(5 * 1024 * 1024 + 10)
    const bigImage = new File([bigBuffer], 'huge.png', { type: 'image/png' })
    await expect(resizeImageToAvatarDataUrl(bigImage)).rejects.toThrow(/larger than 5 MB/i)
  })
})

describe('ProfileMenu header interaction', () => {
  beforeEach(() => {
    usePrefsStore.setState({
      prefs: { ...DEFAULT_PREFS },
      profile: { ...DEFAULT_PROFILE },
      viewedIds: [],
      lastResult: null,
    })
  })

  it('opens menu on click, allows quick avatar & theme switches, and navigates to /profile', () => {
    renderWithProviders(
      <div>
        <ProfileMenu />
        <Routes>
          <Route path="/" element={<div>Home Route</div>} />
          <Route path="/profile" element={<Profile />} />
        </Routes>
      </div>,
    )

    const trigger = screen.getByRole('button', { name: /Operator profile menu/i })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(trigger).toHaveTextContent('R')
    const initialBadge = trigger.querySelector('.tp-avatar') as HTMLElement | null
    expect(initialBadge).not.toBeNull()
    expect(initialBadge?.className).toContain('border-white/30')
    expect(initialBadge?.style.backgroundColor).toBe('rgb(2, 132, 199)')
    expect(initialBadge?.querySelector('svg[data-drawing="tone-ocean"]')).not.toBeNull()

    fireEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('dialog', { name: /Operator profile menu/i })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Choose Orbital Pass avatar/i }))
    expect(usePrefsStore.getState().profile.avatarKind).toBe('preset')
    expect(usePrefsStore.getState().profile.avatarPreset).toBe('satellite')
    expect(trigger.querySelector('svg[data-drawing="preset-satellite"]')).not.toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /Select Geo Emerald badge tone/i }))
    expect(usePrefsStore.getState().profile.avatarTone).toBe('emerald')
    const updatedBadge = trigger.querySelector('.tp-avatar') as HTMLElement | null
    expect(updatedBadge?.style.backgroundColor).toBe('rgb(5, 150, 105)')
    expect(
      screen
        .getByRole('button', { name: /Select Geo Emerald badge tone/i })
        .querySelector('svg[data-drawing="tone-emerald"]'),
    ).not.toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /Switch to Light High-Contrast Theme/i }))
    expect(usePrefsStore.getState().prefs.theme).toBe('light')

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('button', { name: /View & Edit Profile/i }))
    expect(screen.getByRole('heading', { name: 'Operator Profile' })).toBeInTheDocument()
  })
})

describe('Profile page avatar choice and details editor', () => {
  beforeEach(() => {
    usePrefsStore.setState({
      prefs: { ...DEFAULT_PREFS },
      profile: { ...DEFAULT_PROFILE },
      viewedIds: [],
      lastResult: null,
    })
  })

  it('lets operator choose icon avatar, accent tone, edit details, and reset', () => {
    const { container } = renderWithProviders(<Profile />, '/profile')

    // In default Monogram mode, selecting a Badge Accent Color stamps its drawing on the profile badges
    const amberToneBtn = screen.getByRole('button', { name: /Select SAR Amber avatar color/i })
    fireEvent.click(amberToneBtn)
    const monogramBadges = container.querySelectorAll('.tp-avatar')
    expect(monogramBadges.length).toBeGreaterThanOrEqual(2)
    expect(monogramBadges[0].querySelector('svg[data-drawing="tone-amber"]')).not.toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Icon Avatars' }))
    const radarPresetBtn = screen.getByRole('button', { name: /L-Band SAR/i })
    expect(radarPresetBtn.querySelector('svg[data-drawing="preset-radar"]')).not.toBeNull()
    fireEvent.click(radarPresetBtn)
    expect(usePrefsStore.getState().profile.avatarKind).toBe('preset')
    expect(usePrefsStore.getState().profile.avatarPreset).toBe('radar')

    const violetToneBtn = screen.getByRole('button', { name: /Select Radar Violet avatar color/i })
    expect(violetToneBtn.querySelector('svg[data-drawing="tone-violet"]')).not.toBeNull()
    fireEvent.click(violetToneBtn)
    expect(usePrefsStore.getState().profile.avatarTone).toBe('violet')

    const nameInput = screen.getByLabelText('Display Name')
    const roleInput = screen.getByLabelText('Role / Title')
    fireEvent.change(nameInput, { target: { value: 'Meera Nair' } })
    fireEvent.change(roleInput, { target: { value: 'Lead Hydrologist' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Profile' }))

    expect(usePrefsStore.getState().profile.displayName).toBe('Meera Nair')
    expect(usePrefsStore.getState().profile.role).toBe('Lead Hydrologist')

    fireEvent.click(screen.getByRole('button', { name: /Reset to defaults/i }))
    expect(usePrefsStore.getState().profile.displayName).toBe('Researcher')
    expect(usePrefsStore.getState().profile.avatarKind).toBe('initials')
  })

  it('opens Settings Account tab cleanly and links into Profile Studio', () => {
    usePrefsStore.getState().setProfile({ displayName: 'Aarav Sharma', role: 'SAR Engineer' })
    renderWithProviders(
      <Routes>
        <Route path="/settings" element={<Settings />} />
        <Route path="/profile" element={<Profile />} />
      </Routes>,
      '/settings?tab=account',
    )

    expect(screen.getByText('Operator Profile & Avatar')).toBeInTheDocument()
    expect(screen.getByText('Aarav Sharma')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Open Profile & Avatar Studio/i }))
    expect(screen.getByRole('heading', { name: 'Operator Profile' })).toBeInTheDocument()
  })
})

