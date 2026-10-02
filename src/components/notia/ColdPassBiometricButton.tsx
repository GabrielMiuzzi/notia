import { useEffect, useState } from 'react'
import { Fingerprint } from 'lucide-react'
import { useAppSelector } from '../../store/hooks'
import { selectActiveLibrary } from '../../features/library/librarySelectors'
import { useConfirmationEngine } from '../../context/confirmation/useConfirmationEngine'
import {
  disableColdPassBiometric,
  enableColdPassBiometric,
  getColdPassBiometricStatus,
  isColdPassCancellation,
  type ColdPassBiometricStatus,
} from '../../services/coldpass/coldpassStorage'
import { ColdPassOwnerPasswordModal } from './ColdPassOwnerPasswordModal'

interface ColdPassBiometricButtonProps {
  /** Shows the result in the view's toast. */
  onChanged: (message: string) => void
  /** Phone header: an icon button that is pressed while the fingerprint is on. */
  compact?: boolean
}

interface EnablePromptState {
  open: boolean
  errorMessage: string | null
  isSubmitting: boolean
}

const CLOSED_PROMPT: EnablePromptState = { open: false, errorMessage: null, isSubmitting: false }

/**
 * Turns this device's fingerprint on or off for ColdPass while the vault is
 * open. Hidden where there is no compatible sensor (Windows, older Android).
 */
export function ColdPassBiometricButton({ onChanged, compact = false }: ColdPassBiometricButtonProps) {
  const library = useAppSelector(selectActiveLibrary)
  const libraryId = library?.id ?? null
  const { confirm } = useConfirmationEngine()
  const [status, setStatus] = useState<ColdPassBiometricStatus | null>(null)
  const [prompt, setPrompt] = useState<EnablePromptState>(CLOSED_PROMPT)
  const [isDisabling, setIsDisabling] = useState(false)

  useEffect(() => {
    if (!libraryId) {
      return
    }
    let cancelled = false
    void getColdPassBiometricStatus(libraryId)
      .then((next) => {
        if (!cancelled) setStatus(next)
      })
      .catch(() => {
        if (!cancelled) setStatus(null)
      })
    return () => {
      cancelled = true
    }
  }, [libraryId])

  if (!libraryId || !status || status.availability === 'unsupported') {
    return null
  }

  const notEnrolled = status.availability === 'not-enrolled'

  const enable = (password: string) => {
    setPrompt({ open: true, errorMessage: null, isSubmitting: true })
    void enableColdPassBiometric(libraryId, password)
      .then((next) => {
        setStatus(next)
        setPrompt(CLOSED_PROMPT)
        onChanged('Huella activada: la próxima vez ColdPass se abre con tu dedo.')
      })
      .catch((error) => {
        setPrompt({
          open: true,
          errorMessage: isColdPassCancellation(error)
            ? null
            : error instanceof Error ? error.message : 'No se pudo activar la huella.',
          isSubmitting: false,
        })
      })
  }

  const disable = async () => {
    const shouldDisable = await confirm({
      title: 'Desactivar huella',
      message: 'ColdPass volverá a pedir la contraseña del Owner en este dispositivo.',
      confirmLabel: 'Desactivar',
      cancelLabel: 'Cancelar',
    })
    if (!shouldDisable) {
      return
    }
    setIsDisabling(true)
    try {
      setStatus(await disableColdPassBiometric(libraryId))
      onChanged('Huella desactivada.')
    } catch (error) {
      onChanged(error instanceof Error ? error.message : 'No se pudo desactivar la huella.')
    } finally {
      setIsDisabling(false)
    }
  }

  const label = status.enabled ? 'Huella activada' : 'Activar huella'

  return (
    <>
      <button
        type="button"
        className={compact ? 'cp-icon' : 'cp-btn cp-btn--ghost'}
        aria-pressed={status.enabled}
        aria-label={compact ? label : undefined}
        disabled={notEnrolled || isDisabling}
        title={notEnrolled ? 'Registrá una huella en los ajustes de Android para usarla en ColdPass.' : undefined}
        onClick={() => {
          if (status.enabled) {
            void disable()
          } else {
            setPrompt({ open: true, errorMessage: null, isSubmitting: false })
          }
        }}
      >
        <Fingerprint size={compact ? 20 : 18} strokeWidth={1.75} aria-hidden="true" />
        {compact ? null : label}
      </button>
      <ColdPassOwnerPasswordModal
        open={prompt.open}
        title="Activar huella"
        message="Ingresá la contraseña del Owner y después apoyá el dedo en el sensor. La huella abre ColdPass solo en este dispositivo; si cambian las huellas registradas en Android, se vuelve a pedir la contraseña."
        submitLabel="Continuar"
        submittingLabel="Esperando la huella…"
        errorMessage={prompt.errorMessage}
        isSubmitting={prompt.isSubmitting}
        onSubmit={({ password }) => enable(password)}
        onClose={() => setPrompt(CLOSED_PROMPT)}
      />
    </>
  )
}
