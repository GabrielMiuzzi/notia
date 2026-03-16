import { useEffect, useState } from 'react'
import { KeyRound, ShieldCheck, X } from 'lucide-react'
import { NotiaModalShell } from './NotiaModalShell'
import { NotiaButton } from '../common/NotiaButton'

interface ColdPassBluetoothAuthModalProps {
  open: boolean
  errorMessage?: string | null
  isSubmitting?: boolean
  onSubmit: (values: { passkey: string; challenge: string }) => void
  onClose: () => void
}

export function ColdPassBluetoothAuthModal({
  open,
  errorMessage,
  isSubmitting = false,
  onSubmit,
  onClose,
}: ColdPassBluetoothAuthModalProps) {
  const [passkey, setPasskey] = useState('')
  const [challenge, setChallenge] = useState('')

  useEffect(() => {
    if (!open) {
      setPasskey('')
      setChallenge('')
    }
  }, [open])

  if (!open) {
    return null
  }

  const canSubmit = Boolean(passkey.trim() && challenge.trim())

  return (
    <NotiaModalShell open={open} onClose={onClose} size="sm" panelClassName="notia-coldpass-passkey-modal">
      <div className="notia-coldpass-passkey-header">
        <div className="notia-coldpass-passkey-title">
          <ShieldCheck size={16} />
          <h2>Autenticar ColdPass</h2>
        </div>
        <NotiaButton size="icon" variant="ghost" className="notia-settings-close" title="Cerrar" onClick={onClose}>
          <X size={16} />
        </NotiaButton>
      </div>
      <div className="notia-coldpass-passkey-body">
        <p>Ingresá la PassKey y el Challenge que muestra la placa para completar la autenticación segura.</p>
        <div className="notia-settings-input-wrap">
          <input
            autoFocus
            className="notia-settings-input notia-coldpass-passkey-input"
            type="text"
            value={passkey}
            placeholder="PassKey"
            onChange={(event) => {
              setPasskey(event.target.value)
            }}
          />
        </div>
        <div className="notia-settings-input-wrap">
          <div className="notia-coldpass-passkey-inline-label">
            <KeyRound size={14} />
            <span>Challenge</span>
          </div>
          <input
            className="notia-settings-input notia-coldpass-passkey-input"
            type="text"
            value={challenge}
            placeholder="Challenge"
            onChange={(event) => {
              setChallenge(event.target.value)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && canSubmit) {
                event.preventDefault()
                onSubmit({ passkey, challenge })
              }
            }}
          />
        </div>
        {errorMessage ? <div className="notia-coldpass-passkey-error">{errorMessage}</div> : null}
        {isSubmitting ? (
          <div className="notia-coldpass-operation-status" role="status" aria-live="polite">
            <div className="notia-coldpass-operation-spinner" aria-hidden="true" />
            <span>Esperando validacion segura de la placa...</span>
          </div>
        ) : null}
      </div>
      <div className="notia-coldpass-passkey-actions">
        <NotiaButton variant="secondary" onClick={onClose} disabled={isSubmitting}>
          Cancelar
        </NotiaButton>
        <NotiaButton
          variant="primary"
          onClick={() => onSubmit({ passkey, challenge })}
          disabled={!canSubmit || isSubmitting}
        >
          {isSubmitting ? 'Autenticando...' : 'Aceptar'}
        </NotiaButton>
      </div>
    </NotiaModalShell>
  )
}
