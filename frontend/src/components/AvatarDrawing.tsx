import type { ReactNode } from 'react'
import type { AvatarPresetId, AvatarToneId } from '../store/usePrefsStore'

export type DrawingPaletteMode = 'medallion' | 'badge'

interface PaletteColors {
  ink: string
  fill: string
  accent: string
  warm: string
}

const PALETTES: Record<DrawingPaletteMode, PaletteColors> = {
  medallion: {
    ink: '#f8fafc',
    fill: 'rgba(56, 189, 248, 0.24)',
    accent: '#38bdf8',
    warm: '#fde047',
  },
  badge: {
    ink: '#ffffff',
    fill: 'rgba(255, 255, 255, 0.22)',
    accent: '#e0f2fe',
    warm: '#fef08a',
  },
}

interface DrawingFrameProps {
  name: string
  size: number
  children: ReactNode
}

function DrawingFrame({ name, size, children }: DrawingFrameProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      data-drawing={name}
      className="shrink-0"
    >
      {children}
    </svg>
  )
}

function renderPresetArtwork(preset: AvatarPresetId, p: PaletteColors): ReactNode {
  switch (preset) {
    case 'satellite':
      return (
        <>
          <path d="M6.5 4.8v3.4M4.8 6.5h3.4" stroke={p.warm} strokeWidth="1.6" strokeLinecap="round" />
          <g transform="rotate(-38 16 14)">
            <rect x="12.5" y="10" width="7" height="8" rx="1.6" fill={p.fill} stroke={p.ink} strokeWidth="1.8" />
            <rect x="4" y="11.5" width="7" height="5" rx="1" fill={p.fill} stroke={p.accent} strokeWidth="1.6" />
            <path d="M7.5 11.5v5" stroke={p.accent} strokeWidth="1.2" />
            <rect x="21" y="11.5" width="7" height="5" rx="1" fill={p.fill} stroke={p.accent} strokeWidth="1.6" />
            <path d="M24.5 11.5v5" stroke={p.accent} strokeWidth="1.2" />
            <path
              d="M14.2 18l1.8 2.6L17.8 18"
              stroke={p.ink}
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>
          <path d="M20 22.8c2 0 3.6-1.6 3.6-3.6" stroke={p.accent} strokeWidth="1.7" strokeLinecap="round" />
          <path
            d="M19.5 26.2a7 7 0 0 0 7-7"
            stroke={p.warm}
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeOpacity="0.9"
          />
        </>
      )
    case 'globe':
      return (
        <>
          <circle cx="16" cy="16" r="9" fill={p.fill} stroke={p.ink} strokeWidth="1.8" />
          <path
            d="M10.4 12.6c1.5-.6 3 .2 3.2 1.4.2 1.1-.9 1.9-.5 3.1.4 1 1.6 1.3 1.4 2.6-.2 1.1-1.2 1.9-2.5 1.8"
            fill={p.accent}
            fillOpacity="0.4"
            stroke={p.accent}
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M18.6 10.6c1.8.4 3.1 1.8 3.1 3.3 0 1.4-1.2 2-2.3 1.8-1-.2-1.4-1.4-1-2.5.3-.9.5-1.6.2-2.6Z"
            fill={p.accent}
            fillOpacity="0.4"
            stroke={p.accent}
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
          <ellipse
            cx="16"
            cy="16"
            rx="12.4"
            ry="4.5"
            transform="rotate(-22 16 16)"
            stroke={p.ink}
            strokeWidth="1.4"
            strokeDasharray="3 2.5"
            strokeOpacity="0.85"
          />
          <circle cx="26.2" cy="11.5" r="2" fill={p.warm} stroke={p.ink} strokeWidth="1.1" />
        </>
      )
    case 'radar':
      return (
        <>
          <path
            d="M7.2 11.4a10 10 0 0 0 13.8 13.8L7.2 11.4Z"
            fill={p.fill}
            stroke={p.ink}
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
          <path
            d="M11.4 23.4L9.4 27.6h7.4l-1.8-2.8"
            stroke={p.ink}
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path d="M14 18.4l4.8-4.8" stroke={p.ink} strokeWidth="1.7" strokeLinecap="round" />
          <circle cx="19.3" cy="13.1" r="1.7" fill={p.warm} />
          <path d="M19.5 8.5a6.5 6.5 0 0 1 5.5 5.5" stroke={p.accent} strokeWidth="1.7" strokeLinecap="round" />
          <path
            d="M20.8 5.2a10 10 0 0 1 7.4 7.4"
            stroke={p.accent}
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeOpacity="0.82"
          />
        </>
      )
    case 'waves':
      return (
        <>
          <circle cx="22.5" cy="8.5" r="3" fill={p.warm} fillOpacity="0.9" />
          <path
            d="M9.6 5.4c1.5 2 2.4 3.4 2.4 4.6a2.4 2.4 0 1 1-4.8 0c0-1.2.9-2.6 2.4-4.6Z"
            fill={p.fill}
            stroke={p.accent}
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <path
            d="M4.6 17.4c2.2 0 2.7-1.9 4.9-1.9s2.7 1.9 4.9 1.9 2.7-1.9 4.9-1.9 2.7 1.9 4.9 1.9 2-1.1 3-1.7"
            stroke={p.ink}
            strokeWidth="1.9"
            strokeLinecap="round"
          />
          <path
            d="M4.6 21.8c2.2 0 2.7-1.8 4.9-1.8s2.7 1.8 4.9 1.8 2.7-1.8 4.9-1.8 2.7 1.8 4.9 1.8 2-1 3-1.5"
            stroke={p.accent}
            strokeWidth="1.8"
            strokeLinecap="round"
          />
          <path
            d="M6.6 26c2.1 0 2.5-1.3 4.6-1.3s2.5 1.3 4.7 1.3 2.5-1.3 4.7-1.3 2.4 1.3 4.6 1.3"
            stroke={p.ink}
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeOpacity="0.82"
          />
        </>
      )
    case 'compass':
      return (
        <>
          <path d="M14 5a2 2 0 0 1 4 0" stroke={p.ink} strokeWidth="1.6" strokeLinecap="round" />
          <circle cx="16" cy="17" r="10" fill={p.fill} stroke={p.ink} strokeWidth="1.8" />
          <path
            d="M16 8.6v1.6M16 23.8v1.6M7.6 17h1.6M22.8 17h1.6"
            stroke={p.accent}
            strokeWidth="1.5"
            strokeLinecap="round"
          />
          <path
            d="M20.3 12.7l-2.8 5.8-5.8 2.8 2.8-5.8 5.8-2.8Z"
            fill={p.fill}
            stroke={p.ink}
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <path d="M20.3 12.7l-2.8 5.8-3-3 5.8-2.8Z" fill={p.warm} />
          <circle cx="16" cy="17" r="1.4" fill={p.ink} />
        </>
      )
    case 'mountain':
      return (
        <>
          <circle cx="22.4" cy="9" r="2.6" fill={p.warm} fillOpacity="0.92" />
          <path
            d="M15.6 23.8l5.1-8 6.6 8H15.6Z"
            fill={p.fill}
            stroke={p.accent}
            strokeWidth="1.7"
            strokeLinejoin="round"
          />
          <path
            d="M4.6 23.8L12.8 9.8 21 23.8H4.6Z"
            fill={p.fill}
            stroke={p.ink}
            strokeWidth="1.9"
            strokeLinejoin="round"
          />
          <path
            d="M9.8 15l1.5 1.2 1.5-1.3 1.5 1.3 1.5-1.2"
            stroke={p.ink}
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M4.8 26.8c3.8-.9 7.6-.9 11.2 0s7.4.9 11.2 0"
            stroke={p.accent}
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeOpacity="0.85"
          />
        </>
      )
    case 'flame':
      return (
        <>
          <circle cx="9.2" cy="8.4" r="1.2" fill={p.warm} />
          <circle cx="23.8" cy="9.8" r="1.1" fill={p.accent} />
          <path
            d="M16.4 5c2.2 3.2 7 6.6 7 12.4a7.4 7.4 0 1 1-14.8 0c0-3 1.3-5.7 3-7.7.4 1.5 1.5 2.6 2.5 3-.3-2.9.6-5.6 2.3-7.7Z"
            fill={p.fill}
            stroke={p.ink}
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
          <path
            d="M16 14.4c1.8 1.6 3.1 3.3 3.1 5.2a3.1 3.1 0 1 1-6.2 0c0-1.8 1.2-3.5 3.1-5.2Z"
            fill={p.warm}
            fillOpacity="0.88"
            stroke={p.warm}
            strokeWidth="1.2"
            strokeLinejoin="round"
          />
        </>
      )
    case 'shield':
      return (
        <>
          <path
            d="M16 5l8.8 3.5v6.8c0 5.4-3.7 9.6-8.8 11.3-5.1-1.7-8.8-5.9-8.8-11.3V8.5L16 5Z"
            fill={p.fill}
            stroke={p.ink}
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
          <path
            d="M9.6 18.6c4-2.1 8.8-2.1 12.8 0"
            stroke={p.accent}
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeOpacity="0.85"
          />
          <path
            d="M12.2 14.2l2.6 2.6 5.2-5.2"
            stroke={p.warm}
            strokeWidth="2.1"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      )
  }
}

function renderToneArtwork(tone: AvatarToneId): ReactNode {
  switch (tone) {
    case 'ocean':
      return (
        <>
          <path
            d="M16 5.4c1.8 2.1 2.7 3.6 2.7 4.9a2.7 2.7 0 1 1-5.4 0c0-1.3.9-2.8 2.7-4.9Z"
            fill="rgba(255, 255, 255, 0.28)"
            stroke="#ffffff"
            strokeWidth="2.1"
            strokeLinejoin="round"
          />
          <path
            d="M5.5 18.5c2.6 0 3.2-2.2 5.4-2.2s2.8 2.2 5.1 2.2 2.9-2.2 5.1-2.2 2.8 2.2 5.4 2.2"
            stroke="#ffffff"
            strokeWidth="2.2"
            strokeLinecap="round"
          />
          <path
            d="M6.8 24.2c2.3 0 2.8-1.8 4.7-1.8s2.4 1.8 4.5 1.8 2.5-1.8 4.5-1.8 2.4 1.8 4.7 1.8"
            stroke="#e0f2fe"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </>
      )
    case 'cyan':
      return (
        <>
          <circle cx="16" cy="16" r="5.2" fill="rgba(255, 255, 255, 0.26)" stroke="#ffffff" strokeWidth="2.2" />
          <ellipse
            cx="16"
            cy="16"
            rx="11.5"
            ry="4.5"
            transform="rotate(-25 16 16)"
            stroke="#ffffff"
            strokeWidth="2"
          />
          <circle cx="24.5" cy="11" r="2.2" fill="#fef08a" />
        </>
      )
    case 'emerald':
      return (
        <>
          <path
            d="M24.5 7.5C15 7.8 8.5 13 8.2 22.8c8.5.4 15.8-4.5 16.3-15.3Z"
            fill="rgba(255, 255, 255, 0.28)"
            stroke="#ffffff"
            strokeWidth="2.2"
            strokeLinejoin="round"
          />
          <path d="M7.4 24.6c4-4 8-8 12.4-12" stroke="#ffffff" strokeWidth="2.1" strokeLinecap="round" />
        </>
      )
    case 'amber':
      return (
        <>
          <circle cx="16" cy="16" r="4.8" fill="rgba(255, 255, 255, 0.3)" stroke="#ffffff" strokeWidth="2.2" />
          <path
            d="M16 5.5v2.4M16 24.1v2.4M5.5 16h2.4M24.1 16h2.4M8.6 8.6l1.7 1.7M21.7 21.7l1.7 1.7M23.4 8.6l-1.7 1.7M10.3 21.7l-1.7 1.7"
            stroke="#ffffff"
            strokeWidth="2.1"
            strokeLinecap="round"
          />
        </>
      )
    case 'violet':
      return (
        <>
          <circle cx="10.2" cy="21.8" r="2.5" fill="#fef08a" />
          <path
            d="M10.2 15.6a6.2 6.2 0 0 1 6.2 6.2M10.2 10.6a11.2 11.2 0 0 1 11.2 11.2M10.2 5.8a16 16 0 0 1 16 16"
            stroke="#ffffff"
            strokeWidth="2.2"
            strokeLinecap="round"
          />
        </>
      )
    case 'slate':
      return (
        <>
          <path
            d="M5.5 24l6.5-12.5 5.2 9.2 3-4.7 6.3 8H5.5Z"
            fill="rgba(255, 255, 255, 0.28)"
            stroke="#ffffff"
            strokeWidth="2.2"
            strokeLinejoin="round"
          />
          <path
            d="M10.2 15.4l1.8 1.3 1.8-1.3"
            stroke="#fef08a"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      )
  }
}

export interface AvatarPresetDrawingProps {
  preset: AvatarPresetId
  size?: number
  palette?: DrawingPaletteMode
}

/**
 * Renders a bespoke multi-detail Earth observation vector drawing for an avatar preset.
 */
export function AvatarPresetDrawing({ preset, size = 22, palette = 'badge' }: AvatarPresetDrawingProps) {
  return (
    <DrawingFrame name={`preset-${preset}`} size={size}>
      {renderPresetArtwork(preset, PALETTES[palette])}
    </DrawingFrame>
  )
}

export interface AvatarToneDrawingProps {
  tone: AvatarToneId
  size?: number
}

/**
 * Renders a miniature white-ink vector emblem matching each badge accent color tone.
 */
export function AvatarToneDrawing({ tone, size = 14 }: AvatarToneDrawingProps) {
  return (
    <DrawingFrame name={`tone-${tone}`} size={size}>
      {renderToneArtwork(tone)}
    </DrawingFrame>
  )
}

