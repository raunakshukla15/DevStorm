import type { OperatorProfile } from '../store/usePrefsStore'
import { AVATAR_TONES, computeInitials, getAvatarPresetMeta } from '../utils/avatar'

type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl'

const SIZE_CLASSES: Record<AvatarSize, { box: string; text: string; icon: number }> = {
  xs: { box: 'w-6 h-6', text: 'text-[10px]', icon: 13 },
  sm: { box: 'w-8 h-8', text: 'text-xs', icon: 16 },
  md: { box: 'w-10 h-10', text: 'text-sm', icon: 19 },
  lg: { box: 'w-12 h-12', text: 'text-base', icon: 22 },
  xl: { box: 'w-20 h-20', text: 'text-2xl', icon: 36 },
}

export function UserAvatar({
  profile,
  size = 'sm',
  className = '',
}: {
  profile: OperatorProfile
  size?: AvatarSize
  className?: string
}) {
  const dims = SIZE_CLASSES[size]
  const tone = AVATAR_TONES[profile.avatarTone] ?? AVATAR_TONES.ocean

  if (profile.avatarKind === 'photo' && profile.avatarPhotoDataUrl) {
    return (
      <span
        className={`${dims.box} rounded-full overflow-hidden inline-flex items-center justify-center shrink-0 border border-white/30 bg-[#0c1424] ${className}`}
      >
        <img
          src={profile.avatarPhotoDataUrl}
          alt={profile.displayName || 'Operator avatar'}
          className="w-full h-full object-cover"
        />
      </span>
    )
  }

  const badgeStyle = {
    backgroundColor: tone.backgroundColor,
    backgroundImage: tone.gradientCss,
    color: '#ffffff',
  }

  if (profile.avatarKind === 'preset') {
    const preset = getAvatarPresetMeta(profile.avatarPreset)
    const Icon = preset.icon
    return (
      <span
        style={badgeStyle}
        className={`${dims.box} ${tone.bgClass} tp-avatar rounded-full inline-flex items-center justify-center shrink-0 font-bold text-white border border-white/30 shadow-sm select-none ${className}`}
      >
        <Icon size={dims.icon} strokeWidth={2.1} aria-hidden="true" />
      </span>
    )
  }

  const initials = computeInitials(profile.displayName, profile.avatarCustomInitials)
  return (
    <span
      style={badgeStyle}
      className={`${dims.box} ${tone.bgClass} tp-avatar ${dims.text} rounded-full inline-flex items-center justify-center shrink-0 font-bold text-white border border-white/30 shadow-sm select-none ${className}`}
    >
      {initials}
    </span>
  )
}

