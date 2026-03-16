import { useEffect, useState } from 'react'
import { KeyRound, X } from 'lucide-react'
import { NotiaModalShell } from './NotiaModalShell'
import { NotiaButton } from '../common/NotiaButton'

interface ColdPassBluetoothPinModalProps {
  open: boolean
  message: string
  errorMessage?: string | null
  isSubmitting?: boolean
  onSubmit: (pin: string) => void
  onClose: () => void
}

export function ColdPassBluetoothPinModal({
  open,
  message,
  errorMessage,
  isSubmitting = false,
  onSubmit,
  onClose,
}: ColdPassBluetoothPinModalProps) {
  const [pin, setPin] = useState('')

  useEffect(() => {
    if (!open) {
      setPin('')
    }
  }, [open])

  if (!open) {
    return null
  }

  const canSubmit = Boolean(pin.trim())

  return (
    <NotiaModalShell open={open} onClose={onClose} size="sm" panelClassName="notia-coldpass-passkey-modal">
      <div className="notia-coldpass-passkey-header">
        <div className="notia-coldpass-passkey-title">
          <KeyRound size={16} />
          <h2>Ingresar PIN Bluetooth</h2>
        </div>
        <NotiaButton size="icon" variant="ghost" className="notia-settings-close" title="Cerrar" onClick={onClose}>
          <X size={16} />
        </NotiaButton>
      </div>
      <div className="notia-coldpass-passkey-body">
        <p>{message}</p>
        <div className="notia-settings-input-wrap">
          <input
            autoFocus
            className="notia-settings-input notia-coldpass-passkey-input"
            type="password"
            inputMode="numeric"
            value={pin}
            placeholder="Ingresar PIN de la placa"
            onChange={(event) => {
              setPin(event.target.value)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && canSubmit) {
                event.preventDefault()
                onSubmit(pin)
              }
            }}
          />
        </div>
        {errorMessage ? (
          <div className="notia-coldpass-passkey-error">{errorMessage}</div>
        ) : null}
        {isSubmitting ? (
          <div className="notia-coldpass-operation-status" role="status" aria-live="polite">
            <div className="notia-coldpass-operation-spinner" aria-hidden="true" />
            <span>Esperando confirmacion del PIN por ColdPass...</span>
          </div>
        ) : null}
      </div>
      <div className="notia-coldpass-passkey-actions">
        <NotiaButton variant="secondary" onClick={onClose} disabled={isSubmitting}>
          Cancelar
        </NotiaButton>
        <NotiaButton
          variant="primary"
          onClick={() => onSubmit(pin)}
          disabled={!canSubmit || isSubmitting}
        >
          {isSubmitting ? 'Enviando...' : 'Enviar PIN'}
        </NotiaButton>
      </div>
    </NotiaModalShell>
  )
}
