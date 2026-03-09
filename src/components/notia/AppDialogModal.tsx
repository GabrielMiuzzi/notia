import { X } from 'lucide-react'
import { NotiaModalShell } from './NotiaModalShell'
import { NotiaButton } from '../common/NotiaButton'

interface AppDialogModalProps {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  onConfirm: () => void
  onClose: () => void
}

export function AppDialogModal({
  open,
  title,
  message,
  confirmLabel = 'Aceptar',
  cancelLabel,
  onConfirm,
  onClose,
}: AppDialogModalProps) {
  if (!open) {
    return null
  }

  return (
    <NotiaModalShell open={open} onClose={onClose} size="sm" panelClassName="notia-app-dialog">
        <div className="notia-app-dialog-header">
          <h2>{title}</h2>
          <NotiaButton size="icon" variant="ghost" className="notia-settings-close" title="Cerrar" onClick={onClose}>
            <X size={16} />
          </NotiaButton>
        </div>
        <div className="notia-app-dialog-body">{message}</div>
        <div className="notia-app-dialog-actions">
          {cancelLabel ? (
            <NotiaButton variant="secondary" className="notia-app-dialog-button" onClick={onClose}>
              {cancelLabel}
            </NotiaButton>
          ) : null}
          <NotiaButton variant="primary" className="notia-app-dialog-button notia-app-dialog-button--primary" onClick={onConfirm}>
            {confirmLabel}
          </NotiaButton>
        </div>
    </NotiaModalShell>
  )
}
