import type { AvatarPresetId, AvatarToneId } from '../store/usePrefsStore'

export interface AvatarPresetMeta {
  id: AvatarPresetId
  label: string
  subtitle: string
}

export const AVATAR_PRESETS: AvatarPresetMeta[] = [
  { id: 'satellite', label: 'Orbital Pass', subtitle: 'NISAR mission badge' },
  { id: 'globe', label: 'Earth Watch', subtitle: 'Global monitoring' },
  { id: 'radar', label: 'L-Band SAR', subtitle: 'Coherence & backscatter' },
  { id: 'waves', label: 'Hydrology', subtitle: 'Flood & coastal extent' },
  { id: 'compass', label: 'Field Survey', subtitle: 'Geolocation & AOIs' },
  { id: 'mountain', label: 'Terrain', subtitle: 'Landslides & quakes' },
  { id: 'flame', label: 'Thermal', subtitle: 'Volcanic activity' },
  { id: 'shield', label: 'Mission Ops', subtitle: 'Watchlist & alerts' },
]

export interface AvatarToneMeta {
  id: AvatarToneId
  label: string
  bgClass: string
  swatchClass: string
  backgroundColor: string
  gradientCss: string
}

export const AVATAR_TONES: Record<AvatarToneId, AvatarToneMeta> = {
  ocean: {
    id: 'ocean',
    label: 'Ocean Blue',
    bgClass: 'bg-gradient-to-br from-sky-500 to-blue-700',
    swatchClass: 'bg-gradient-to-br from-sky-500 to-blue-700',
    backgroundColor: '#0284c7',
    gradientCss: 'linear-gradient(135deg, #0ea5e9 0%, #1d4ed8 100%)',
  },
  cyan: {
    id: 'cyan',
    label: 'Orbital Cyan',
    bgClass: 'bg-gradient-to-br from-cyan-500 to-teal-700',
    swatchClass: 'bg-gradient-to-br from-cyan-500 to-teal-700',
    backgroundColor: '#0891b2',
    gradientCss: 'linear-gradient(135deg, #06b6d4 0%, #0f766e 100%)',
  },
  emerald: {
    id: 'emerald',
    label: 'Geo Emerald',
    bgClass: 'bg-gradient-to-br from-emerald-500 to-teal-700',
    swatchClass: 'bg-gradient-to-br from-emerald-500 to-teal-700',
    backgroundColor: '#059669',
    gradientCss: 'linear-gradient(135deg, #10b981 0%, #0f766e 100%)',
  },
  amber: {
    id: 'amber',
    label: 'SAR Amber',
    bgClass: 'bg-gradient-to-br from-amber-500 to-orange-700',
    swatchClass: 'bg-gradient-to-br from-amber-500 to-orange-700',
    backgroundColor: '#d97706',
    gradientCss: 'linear-gradient(135deg, #f59e0b 0%, #c2410c 100%)',
  },
  violet: {
    id: 'violet',
    label: 'Radar Violet',
    bgClass: 'bg-gradient-to-br from-violet-500 to-indigo-700',
    swatchClass: 'bg-gradient-to-br from-violet-500 to-indigo-700',
    backgroundColor: '#7c3aed',
    gradientCss: 'linear-gradient(135deg, #8b5cf6 0%, #4338ca 100%)',
  },
  slate: {
    id: 'slate',
    label: 'Slate Steel',
    bgClass: 'bg-gradient-to-br from-slate-600 to-slate-800',
    swatchClass: 'bg-gradient-to-br from-slate-600 to-slate-800',
    backgroundColor: '#334155',
    gradientCss: 'linear-gradient(135deg, #475569 0%, #1e293b 100%)',
  },
}

export const AVATAR_TONE_LIST: AvatarToneMeta[] = Object.values(AVATAR_TONES)

export function getAvatarPresetMeta(id: AvatarPresetId): AvatarPresetMeta {
  return AVATAR_PRESETS.find((p) => p.id === id) ?? AVATAR_PRESETS[0]
}

export function computeInitials(displayName: string, customInitials?: string): string {
  const override = (customInitials ?? '').replace(/\s+/g, '').toUpperCase().slice(0, 2)
  if (override) return override

  const parts = displayName
    .trim()
    .split(/\s+/)
    .filter(Boolean)

  if (parts.length === 0) return 'TP'
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

const MAX_AVATAR_BYTES = 5 * 1024 * 1024

export async function resizeImageToAvatarDataUrl(file: File, targetSize = 192): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Please choose a valid image file (PNG, JPG, WebP, or GIF).')
  }
  if (file.size > MAX_AVATAR_BYTES) {
    throw new Error('Image is larger than 5 MB. Please choose a smaller file.')
  }

  const rawDataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
      } else {
        reject(new Error('Failed to read image file.'))
      }
    }
    reader.onerror = () => reject(new Error('Failed to read image file.'))
    reader.readAsDataURL(file)
  })

  return await new Promise<string>((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const side = Math.min(img.width || targetSize, img.height || targetSize)
      const sx = Math.max(0, Math.floor(((img.width || side) - side) / 2))
      const sy = Math.max(0, Math.floor(((img.height || side) - side) / 2))
      const canvas = document.createElement('canvas')
      canvas.width = targetSize
      canvas.height = targetSize
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        resolve(rawDataUrl)
        return
      }
      ctx.drawImage(img, sx, sy, side, side, 0, 0, targetSize, targetSize)
      const webp = canvas.toDataURL('image/webp', 0.85)
      if (webp.startsWith('data:image/webp')) {
        resolve(webp)
        return
      }
      resolve(canvas.toDataURL('image/jpeg', 0.85))
    }
    img.onerror = () => reject(new Error('Could not decode selected image.'))
    img.src = rawDataUrl
  })
}

