import { X } from 'lucide-react'
import { createPortal } from 'react-dom'
import { NotiaModalShell } from './NotiaModalShell'
import { NotiaButton } from '../common/NotiaButton'

type ConfirmationTone = 'default' | 'danger'

interface ConfirmationDialogModalProps {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  tone?: ConfirmationTone
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmationDialogModal({
  open,
  title,
  message,
  confirmLabel = 'Aceptar',
  cancelLabel = 'Cancelar',
  tone = 'default',
  onConfirm,
  onCancel,
}: ConfirmationDialogModalProps) {
  if (!open) {
    return null
  }

  const dialog = (
    <NotiaModalShell open={open} onClose={onCancel} size="sm" panelClassName="notia-confirm-dialog">
      <div className="notia-confirm-dialog-header">
        <h2>{title}</h2>
        <NotiaButton size="icon" variant="ghost" className="notia-settings-close" title="Cerrar" onClick={onCancel}>
          <X size={16} />
        </NotiaButton>
      </div>

      <div className="notia-confirm-dialog-body">{message}</div>

      <div className="notia-confirm-dialog-actions">
        <NotiaButton variant="secondary" className="notia-confirm-dialog-button" onClick={onCancel}>
          {cancelLabel}
        </NotiaButton>

        <NotiaButton
          className={`notia-confirm-dialog-button ${tone === 'danger' ? 'notia-confirm-dialog-button--danger' : 'notia-confirm-dialog-button--primary'}`}
          variant={tone === 'danger' ? 'danger' : 'primary'}
          onClick={onConfirm}
        >
          {confirmLabel}
        </NotiaButton>
      </div>
    </NotiaModalShell>
  )

  const appShell = document.querySelector('.notia-app-shell')
  if (!appShell) {
    return dialog
  }

  return createPortal(dialog, appShell)
}
