/** Stroke icons of the Task Manager phone boards (paths copied from the canvas). */
const PATHS = {
  search: 'M20 20l-4.2-4.2M17.5 11a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0z',
  gear: 'M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  chevronDown: 'M6 9l6 6 6-6',
  chevronLeft: 'M15 6l-6 6 6 6',
  chevronRight: 'M9 6l6 6-6 6',
  board: 'M3.5 4h5v16h-5zM10 4h5v11h-5zM16.5 4h4v7h-4z',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  management: 'M4 6h8M8 12h9M13 18h7',
  tasks: 'M4 6l1.5 1.5L8 5M4 12l1.5 1.5L8 11M4 18l1.5 1.5L8 17M11 6.5h9M11 12.5h9M11 18.5h9',
  timer: 'M12 9v4l2.5 2M10 2.5h4M20 13a8 8 0 1 1-16 0 8 8 0 0 1 16 0z',
  archive: 'M3.5 7h17v12a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1zM3 4h18v3H3zM10 11h4',
  sliders: 'M4 7h10M18 7h2M4 17h4M12 17h8M18 7a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM12 17a2 2 0 1 1-4 0 2 2 0 0 1 4 0z',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  close: 'M6 6l12 12M18 6L6 18',
  lock: 'M5 11h14v10H5zM8 11V8a4 4 0 0 1 8 0v3',
  unlock: 'M5 11h14v10H5zM8 11V8a4 4 0 0 1 7.5-2',
  alert: 'M12 7.5v5M12 16.5v.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z',
  folder: 'M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z',
  flag: 'M5 21V4M5 4h11l-2 4 2 4H5',
  arrowRight: 'M4 12h16M14 6l6 6-6 6',
  personAdd: 'M3.5 20a6.5 6.5 0 0 1 13 0M18 8v6M15 11h6M13.5 8a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0z',
  clock: 'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z',
  external: 'M14 4h6v6M20 4l-8 8M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  copy: 'M8 8h12v12H8zM16 8V4H4v12h4',
  cancel: 'M6 18L18 6M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3',
  pencil: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
  comment: 'M4 5h16v11H9l-5 4zM12 8.5v4M10 10.5h4',
  send: 'M4 12l16-8-6 16-3-7z',
  restore: 'M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
  note: 'M8 4h9l5 5v13a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM17 4v5h5M10 15h8M10 19h5',
} as const

export type PhoneIconName = keyof typeof PATHS

export function PhoneIcon({ name, size = 18, strokeWidth = 2, className }: { name: PhoneIconName; size?: number; strokeWidth?: number; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={PATHS[name]} />
    </svg>
  )
}

/** ⋯ of the cards and the detail. */
export function KebabIcon({ size = 17 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <circle cx="5.5" cy="12" r="1.7" />
      <circle cx="12" cy="12" r="1.7" />
      <circle cx="18.5" cy="12" r="1.7" />
    </svg>
  )
}

export function PlayIcon({ size = 13 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M8 5.5v13l10.5-6.5z" />
    </svg>
  )
}

export function PauseIcon({ size = 12 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </svg>
  )
}
