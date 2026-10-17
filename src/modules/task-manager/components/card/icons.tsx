import type { ReactNode } from 'react'

/** Stroke icons of the design (24 viewBox, round caps); filled ones say so. */
const ICONS = {
  plus: { d: 'M12 5v14M5 12h14' },
  minus: { d: 'M5 12h14' },
  x: { d: 'M6 6l12 12M18 6L6 18' },
  check: { d: 'M5 12.5l4.5 4.5L19 7.5' },
  chevronDown: { d: 'M6 9l6 6 6-6' },
  chevronRight: { d: 'M9 6l6 6-6 6' },
  chevronLeft: { d: 'M15 6l-6 6 6 6' },
  chevronsRight: { d: 'M7 7l5 5-5 5M13 7l5 5-5 5' },
  chevronsLeft: { d: 'M17 7l-5 5 5 5M11 7l-5 5 5 5' },
  arrowLeft: { d: 'M20 12H4M10 6l-6 6 6 6' },
  arrowRight: { d: 'M4 12h16M14 6l6 6-6 6' },
  folder: { d: 'M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z' },
  checklist: { d: 'M4 6l1.5 1.5L8 5M4 12l1.5 1.5L8 11M4 18l1.5 1.5L8 17M11 6.5h9M11 12.5h9M11 18.5h9' },
  comment: { d: 'M4 5h16v11H9l-5 4zM12 8.5v4M10 10.5h4' },
  commentPlain: { d: 'M4 5h16v11H9l-5 4z' },
  pause: { d: 'M8 5v14M16 5v14' },
  pencil: { d: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4' },
  flag: { d: 'M5 21V4M5 4h11l-2 4 2 4H5' },
  move: { d: 'M4 12h16M14 6l6 6-6 6' },
  people: { d: 'M10 11.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM3.5 20a6.5 6.5 0 0 1 13 0M18 8v6M15 11h6' },
  personPlus: { d: 'M10 11.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM3.5 20a6.5 6.5 0 0 1 11-4.7M18 14v6M15 17h6' },
  clock: { d: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2' },
  copy: { d: 'M8 8h12v12H8zM16 8V4H4v12h4' },
  cancel: { d: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM6 18L18 6' },
  trash: { d: 'M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3' },
  note: { d: 'M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h5' },
  lock: { d: 'M7 11h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2zM8 11V8a4 4 0 0 1 8 0v3' },
  alert: { d: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7.5v5M12 16.5v.01' },
  search: { d: 'M11 17.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM20 20l-4.2-4.2' },
  gear: { d: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1' },
  play: { d: 'M8 5.5v13l10.5-6.5z', filled: true },
} as const

export type IconName = keyof typeof ICONS | 'kebab' | 'grip' | 'pauseBars'

interface IconProps {
  name: IconName
  size?: number
  strokeWidth?: number
  className?: string
}

function filledShape(name: 'kebab' | 'grip' | 'pauseBars'): ReactNode {
  if (name === 'kebab') {
    return (
      <>
        <circle cx="5.5" cy="12" r="1.6" />
        <circle cx="12" cy="12" r="1.6" />
        <circle cx="18.5" cy="12" r="1.6" />
      </>
    )
  }
  if (name === 'grip') {
    return (
      <>
        <circle cx="9" cy="6" r="1.6" />
        <circle cx="15" cy="6" r="1.6" />
        <circle cx="9" cy="12" r="1.6" />
        <circle cx="15" cy="12" r="1.6" />
        <circle cx="9" cy="18" r="1.6" />
        <circle cx="15" cy="18" r="1.6" />
      </>
    )
  }
  return (
    <>
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </>
  )
}

export function Icon({ name, size = 14, strokeWidth = 2, className }: IconProps) {
  if (name === 'kebab' || name === 'grip' || name === 'pauseBars') {
    return (
      <svg className={className} aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
        {filledShape(name)}
      </svg>
    )
  }
  const icon = ICONS[name]
  const filled = 'filled' in icon && icon.filled
  return (
    <svg
      className={className}
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={icon.d} />
    </svg>
  )
}
