import type { KeyboardEvent, HTMLAttributes, ReactNode } from 'react'

interface NotiaCardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
  interactive?: boolean
  selected?: boolean
}

export function NotiaCard({
  children,
  interactive = false,
  selected = false,
  className,
  onClick,
  onKeyDown,
  ...rest
}: NotiaCardProps) {
  const classes = ['notia-card', interactive ? 'notia-card--interactive' : '', selected ? 'is-selected' : '', className]
    .filter(Boolean)
    .join(' ')

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (interactive && onClick && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault()
      onClick(event as unknown as Parameters<NonNullable<typeof onClick>>[0])
      return
    }

    onKeyDown?.(event)
  }

  return (
    <div
      className={classes}
      role={interactive ? 'button' : rest.role}
      tabIndex={interactive ? 0 : rest.tabIndex}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      {...rest}
    >
      {children}
    </div>
  )
}
