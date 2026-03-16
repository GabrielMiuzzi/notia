import { useEffect, useState } from 'react'
import { Eye, EyeOff, KeyRound, X } from 'lucide-react'
import { NotiaModalShell } from './NotiaModalShell'
import { NotiaButton } from '../common/NotiaButton'

interface ColdPassPasskeyModalProps {
  open: boolean
  title: string
  message: string
  requiresConfirmation?: boolean
  errorMessage?: string | null
  isSubmitting?: boolean
  onSubmit: (passkey: string) => void
  onClose: () => void
}

export function ColdPassPasskeyModal({
  open,
  title,
  message,
  requiresConfirmation = false,
  errorMessage,
  isSubmitting = false,
  onSubmit,
  onClose,
}: ColdPassPasskeyModalProps) {
  const [passkey, setPasskey] = useState('')
  const [confirmPasskey, setConfirmPasskey] = useState('')
  const [isPasskeyVisible, setIsPasskeyVisible] = useState(false)

  useEffect(() => {
    if (!open) {
      setPasskey('')
      setConfirmPasskey('')
      setIsPasskeyVisible(false)
    }
  }, [open])

  const localErrorMessage = requiresConfirmation && confirmPasskey && passkey !== confirmPasskey
    ? 'Las passkeys no coinciden.'
    : null

  const canSubmit = requiresConfirmation
    ? Boolean(passkey.trim() && confirmPasskey.trim() && passkey === confirmPasskey)
    : Boolean(passkey.trim())

  if (!open) {
    return null
  }

  return (
    <NotiaModalShell open={open} onClose={onClose} size="sm" panelClassName="notia-coldpass-passkey-modal">
      <div className="notia-coldpass-passkey-header">
        <div className="notia-coldpass-passkey-title">
          <KeyRound size={16} />
          <h2>{title}</h2>
        </div>
        <NotiaButton size="icon" variant="ghost" className="notia-settings-close" title="Cerrar" onClick={onClose}>
          <X size={16} />
        </NotiaButton>
      </div>
      <div className="notia-coldpass-passkey-body">
        <p>{message}</p>
        <div className="notia-settings-input-wrap">
          <div className="notia-coldpass-passkey-field">
            <input
              autoFocus
              className="notia-settings-input notia-coldpass-passkey-input"
              type={isPasskeyVisible ? 'text' : 'password'}
              value={passkey}
              placeholder="Ingresar passkey"
              onChange={(event) => {
                setPasskey(event.target.value)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && canSubmit) {
                  event.preventDefault()
                  onSubmit(passkey)
                }
              }}
            />
            <NotiaButton
              type="button"
              size="icon"
              variant="ghost"
              className="notia-coldpass-passkey-visibility"
              title={isPasskeyVisible ? 'Ocultar passkey' : 'Mostrar passkey'}
              onClick={() => {
                setIsPasskeyVisible((current) => !current)
              }}
            >
              {isPasskeyVisible ? <EyeOff size={16} /> : <Eye size={16} />}
            </NotiaButton>
          </div>
        </div>
        {requiresConfirmation ? (
          <div className="notia-settings-input-wrap">
            <div className="notia-coldpass-passkey-field">
              <input
                className="notia-settings-input notia-coldpass-passkey-input"
                type={isPasskeyVisible ? 'text' : 'password'}
                value={confirmPasskey}
                placeholder="Confirmar passkey"
                onChange={(event) => {
                  setConfirmPasskey(event.target.value)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && canSubmit) {
                    event.preventDefault()
                    onSubmit(passkey)
                  }
                }}
              />
            </div>
          </div>
        ) : null}
        {localErrorMessage || errorMessage ? (
          <div className="notia-coldpass-passkey-error">{localErrorMessage ?? errorMessage}</div>
        ) : null}
      </div>
      <div className="notia-coldpass-passkey-actions">
        <NotiaButton variant="secondary" onClick={onClose} disabled={isSubmitting}>
          Cancelar
        </NotiaButton>
        <NotiaButton
          variant="primary"
          onClick={() => onSubmit(passkey)}
          disabled={!canSubmit || isSubmitting}
        >
          {isSubmitting ? (requiresConfirmation ? 'Creando...' : 'Desbloqueando...') : (requiresConfirmation ? 'Crear' : 'Desbloquear')}
        </NotiaButton>
      </div>
    </NotiaModalShell>
  )
}
