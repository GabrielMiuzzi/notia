import { useEffect, useState } from 'react'
import { MessageSquareText, X } from 'lucide-react'
import { NotiaModalShell } from './NotiaModalShell'
import { NotiaButton } from '../common/NotiaButton'

interface ColdPassBluetoothMessageModalProps {
  open: boolean
  errorMessage?: string | null
  isSubmitting?: boolean
  onSubmit: (message: string) => void
  onClose: () => void
}

export function ColdPassBluetoothMessageModal({
  open,
  errorMessage,
  isSubmitting = false,
  onSubmit,
  onClose,
}: ColdPassBluetoothMessageModalProps) {
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!open) {
      setMessage('')
    }
  }, [open])

  if (!open) {
    return null
  }

  const canSubmit = Boolean(message.trim())

  return (
    <NotiaModalShell open={open} onClose={onClose} size="sm" panelClassName="notia-coldpass-passkey-modal">
      <div className="notia-coldpass-passkey-header">
        <div className="notia-coldpass-passkey-title">
          <MessageSquareText size={16} />
          <h2>Mandar mensaje</h2>
        </div>
        <NotiaButton size="icon" variant="ghost" className="notia-settings-close" title="Cerrar" onClick={onClose}>
          <X size={16} />
        </NotiaButton>
      </div>
      <div className="notia-coldpass-passkey-body">
        <p>El mensaje se cifra con la PassKey autenticada de esta sesión antes de enviarse a la placa.</p>
        <div className="notia-settings-input-wrap">
          <textarea
            autoFocus
            className="notia-settings-input notia-coldpass-message-textarea"
            value={message}
            placeholder="Escribir mensaje"
            onChange={(event) => {
              setMessage(event.target.value)
            }}
          />
        </div>
        {errorMessage ? <div className="notia-coldpass-passkey-error">{errorMessage}</div> : null}
        {isSubmitting ? (
          <div className="notia-coldpass-operation-status" role="status" aria-live="polite">
            <div className="notia-coldpass-operation-spinner" aria-hidden="true" />
            <span>Esperando confirmacion del mensaje por ColdPass...</span>
          </div>
        ) : null}
      </div>
      <div className="notia-coldpass-passkey-actions">
        <NotiaButton variant="secondary" onClick={onClose} disabled={isSubmitting}>
          Cancelar
        </NotiaButton>
        <NotiaButton
          variant="primary"
          onClick={() => onSubmit(message)}
          disabled={!canSubmit || isSubmitting}
        >
          {isSubmitting ? 'Enviando...' : 'Mandar mensaje'}
        </NotiaButton>
      </div>
    </NotiaModalShell>
  )
}
