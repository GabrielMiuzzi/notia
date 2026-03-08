import { X } from 'lucide-react'

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
    <div className="notia-modal-backdrop" onClick={onClose}>
      <div className="notia-app-dialog" onClick={(event) => event.stopPropagation()}>
        <div className="notia-app-dialog-header">
          <h2>{title}</h2>
          <button type="button" className="notia-settings-close" title="Cerrar" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="notia-app-dialog-body">{message}</div>
        <div className="notia-app-dialog-actions">
          {cancelLabel ? (
            <button type="button" className="notia-app-dialog-button" onClick={onClose}>
              {cancelLabel}
            </button>
          ) : null}
          <button type="button" className="notia-app-dialog-button notia-app-dialog-button--primary" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
