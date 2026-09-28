import { useEffect, useId, useState } from 'react'
import { Eye, EyeOff, KeyRound, X } from 'lucide-react'
import { NotiaModalShell } from './NotiaModalShell'
import { NotiaButton } from '../common/NotiaButton'

export interface ColdPassOwnerPasswordValues {
  password: string
  legacyPasskey?: string
}

interface ColdPassOwnerPasswordModalProps {
  open: boolean
  title: string
  message: string
  submitLabel: string
  submittingLabel: string
  /** The vault still uses its old passkey: ask for it once to migrate it. */
  needsLegacyPasskey?: boolean
  errorMessage?: string | null
  isSubmitting?: boolean
  onSubmit: (values: ColdPassOwnerPasswordValues) => void
  onClose: () => void
}

/** Asks for the Owner's password: it opens ColdPass and confirms deletions and imports. */
export function ColdPassOwnerPasswordModal({
  open,
  title,
  message,
  submitLabel,
  submittingLabel,
  needsLegacyPasskey = false,
  errorMessage,
  isSubmitting = false,
  onSubmit,
  onClose,
}: ColdPassOwnerPasswordModalProps) {
  const [password, setPassword] = useState('')
  const [legacyPasskey, setLegacyPasskey] = useState('')
  const [isVisible, setIsVisible] = useState(false)
  const passwordId = useId()
  const legacyId = useId()

  useEffect(() => {
    if (!open) {
      setPassword('')
      setLegacyPasskey('')
      setIsVisible(false)
    }
  }, [open])

  if (!open) {
    return null
  }

  const canSubmit = Boolean(password) && (!needsLegacyPasskey || Boolean(legacyPasskey))
  const submit = () => {
    if (canSubmit && !isSubmitting) {
      onSubmit(needsLegacyPasskey ? { password, legacyPasskey } : { password })
    }
  }

  return (
    <NotiaModalShell open={open} onClose={onClose} size="sm" panelClassName="notia-coldpass-passkey-modal">
      <form
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <div className="notia-coldpass-passkey-header">
          <div className="notia-coldpass-passkey-title">
            <KeyRound size={16} />
            <h2>{title}</h2>
          </div>
          <NotiaButton type="button" size="icon" variant="ghost" className="notia-settings-close" title="Cerrar" onClick={onClose}>
            <X size={16} />
          </NotiaButton>
        </div>
        <div className="notia-coldpass-passkey-body">
          <p>{message}</p>
          <label className="notia-coldpass-passkey-label" htmlFor={passwordId}>Contraseña del Owner</label>
          <div className="notia-coldpass-passkey-field">
            <input
              id={passwordId}
              autoFocus
              autoComplete="current-password"
              className="notia-settings-input notia-coldpass-passkey-input"
              type={isVisible ? 'text' : 'password'}
              value={password}
              onChange={(event) => {
                setPassword(event.target.value)
              }}
            />
            <NotiaButton
              type="button"
              size="icon"
              variant="ghost"
              className="notia-coldpass-passkey-visibility"
              title={isVisible ? 'Ocultar' : 'Mostrar'}
              aria-label={isVisible ? 'Ocultar lo escrito' : 'Mostrar lo escrito'}
              onClick={() => {
                setIsVisible((current) => !current)
              }}
            >
              {isVisible ? <EyeOff size={16} /> : <Eye size={16} />}
            </NotiaButton>
          </div>
          {needsLegacyPasskey ? (
            <>
              <label className="notia-coldpass-passkey-label" htmlFor={legacyId}>Passkey anterior de ColdPass</label>
              <div className="notia-coldpass-passkey-field">
                <input
                  id={legacyId}
                  autoComplete="off"
                  className="notia-settings-input notia-coldpass-passkey-input"
                  type={isVisible ? 'text' : 'password'}
                  value={legacyPasskey}
                  onChange={(event) => {
                    setLegacyPasskey(event.target.value)
                  }}
                />
              </div>
              <p className="notia-coldpass-passkey-hint">
                Se pide una sola vez: el vault se vuelve a cifrar con la contraseña del Owner y la passkey deja de usarse.
              </p>
            </>
          ) : null}
          {errorMessage ? <div className="notia-coldpass-passkey-error" role="alert">{errorMessage}</div> : null}
        </div>
        <div className="notia-coldpass-passkey-actions">
          <NotiaButton type="button" variant="secondary" onClick={onClose} disabled={isSubmitting}>
            Cancelar
          </NotiaButton>
          <NotiaButton type="submit" variant="primary" disabled={!canSubmit || isSubmitting}>
            {isSubmitting ? submittingLabel : submitLabel}
          </NotiaButton>
        </div>
      </form>
    </NotiaModalShell>
  )
}
