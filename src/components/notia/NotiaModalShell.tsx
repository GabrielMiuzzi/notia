import type { CSSProperties, ReactNode } from 'react'

interface NotiaModalShellProps {
  open: boolean
  onClose: () => void
  children: ReactNode
  panelClassName?: string
  size?: 'sm' | 'md' | 'lg' | 'xl'
  panelStyle?: CSSProperties
}

const resolveSizeClass = (size: NotiaModalShellProps['size']): string => {
  if (size === 'sm') {
    return 'notia-modal-engine-panel--sm'
  }
  if (size === 'md') {
    return 'notia-modal-engine-panel--md'
  }
  if (size === 'xl') {
    return 'notia-modal-engine-panel--xl'
  }
  return 'notia-modal-engine-panel--lg'
}

export function NotiaModalShell({
  open,
  onClose,
  children,
  panelClassName,
  size = 'lg',
  panelStyle,
}: NotiaModalShellProps) {
  if (!open) {
    return null
  }

  const panelClasses = ['notia-modal-engine-panel', resolveSizeClass(size), panelClassName]
    .filter(Boolean)
    .join(' ')

  return (
    <div className="notia-modal-engine-backdrop" onClick={onClose}>
      <div className={panelClasses} style={panelStyle} onClick={(event) => event.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}
