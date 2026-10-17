import type { CSSProperties } from 'react'

interface AvatarProps {
  initials: string
  /** Board color of the person, as data. */
  color: string
  name?: string
  size?: 'sm' | 'md'
  className?: string
}

/** Initials over a wash of the person's color. */
export function Avatar({ initials, color, name, size = 'sm', className }: AvatarProps) {
  return (
    <span
      className={`tm-person tm-person--${size}${className ? ` ${className}` : ''}`}
      style={{ '--tm-person': color } as CSSProperties}
      title={name}
      aria-hidden="true"
    >
      {initials}
    </span>
  )
}
