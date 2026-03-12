import type { CSSProperties, ReactNode } from 'react'
import { NotiaModalShell } from '../../../../components/notia/NotiaModalShell'

interface TaskManagerModalProps {
  open: boolean
  onClose: () => void
  children: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
  panelClassName?: string
  panelStyle?: CSSProperties
}

export function TaskManagerModal({
  open,
  onClose,
  children,
  size = 'lg',
  panelClassName,
  panelStyle,
}: TaskManagerModalProps) {
  const mergedPanelClassName = ['tareas-dialog', panelClassName].filter(Boolean).join(' ')

  return (
    <NotiaModalShell
      open={open}
      onClose={onClose}
      size={size}
      panelClassName={mergedPanelClassName}
      panelStyle={panelStyle}
    >
      {children}
    </NotiaModalShell>
  )
}
