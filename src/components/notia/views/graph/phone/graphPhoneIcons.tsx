import type { ReactNode } from 'react'

/* The stroke icons of the phone boards of the Graph View canvas, as drawn there. */

function StrokeIcon({ size, strokeWidth = 2, children }: { size: number; strokeWidth?: number; children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

export function SearchIcon() {
  return <StrokeIcon size={20}><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></StrokeIcon>
}

export function ViewSettingsIcon() {
  return (
    <StrokeIcon size={20}>
      <path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1" />
      <circle cx="15" cy="6" r="2" />
      <circle cx="9" cy="12" r="2" />
      <circle cx="17" cy="18" r="2" />
    </StrokeIcon>
  )
}

export function BackIcon() {
  return <StrokeIcon size={20}><path d="M15 5l-7 7 7 7" /></StrokeIcon>
}

export function CloseIcon({ size, strokeWidth }: { size: number; strokeWidth: number }) {
  return <StrokeIcon size={size} strokeWidth={strokeWidth}><path d="M6 6l12 12M18 6L6 18" /></StrokeIcon>
}

export function FitIcon() {
  return <StrokeIcon size={18}><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></StrokeIcon>
}

export function LocalGraphIcon({ size }: { size: number }) {
  return <StrokeIcon size={size}><circle cx="12" cy="12" r="3" /><circle cx="12" cy="12" r="8" /></StrokeIcon>
}

export function OpenNoteIcon() {
  return (
    <StrokeIcon size={16} strokeWidth={2.2}>
      <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
    </StrokeIcon>
  )
}

export function ChevronIcon() {
  return <StrokeIcon size={14}><path d="M9 6l6 6-6 6" /></StrokeIcon>
}
