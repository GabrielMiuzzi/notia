// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ColdPassOwnerPasswordModal } from './ColdPassOwnerPasswordModal'

const callBackend = vi.fn()
vi.mock('../../services/transport', () => ({
  callBackend: (...args: unknown[]) => callBackend(...args),
}))

function renderModal(props: Partial<Parameters<typeof ColdPassOwnerPasswordModal>[0]> = {}) {
  return render(
    <ColdPassOwnerPasswordModal
      open
      title="Desbloquear ColdPass"
      message="Ingresá la contraseña del Owner."
      submitLabel="Desbloquear"
      submittingLabel="Desbloqueando…"
      onSubmit={() => {}}
      onClose={() => {}}
      {...props}
    />,
  )
}

describe('ColdPassOwnerPasswordModal', () => {
  afterEach(() => {
    cleanup()
    callBackend.mockReset()
  })

  it('asks for the fingerprint once when it opens and offers it again with a button', () => {
    const onUseBiometric = vi.fn()
    const { rerender } = renderModal({ onUseBiometric, autoBiometric: true })
    expect(onUseBiometric).toHaveBeenCalledTimes(1)

    rerender(
      <ColdPassOwnerPasswordModal
        open
        title="Desbloquear ColdPass"
        message="Ingresá la contraseña del Owner."
        submitLabel="Desbloquear"
        submittingLabel="Desbloqueando…"
        onUseBiometric={onUseBiometric}
        autoBiometric
        errorMessage="Se canceló"
        onSubmit={() => {}}
        onClose={() => {}}
      />,
    )
    expect(onUseBiometric).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Usar huella' }))
    expect(onUseBiometric).toHaveBeenCalledTimes(2)
  })

  it('shows only the password where the fingerprint is not on', () => {
    renderModal()
    expect(screen.queryByRole('button', { name: 'Usar huella' })).toBeNull()
  })

  it('keeps the backend code so a cancelled fingerprint is not reported', async () => {
    const { isColdPassCancellation, unlockColdPassWithBiometric } = await import('../../services/coldpass/coldpassStorage')
    callBackend.mockRejectedValueOnce({ code: 'cancelled', message: 'Se canceló la huella.', retryable: true })
    const cancelled = await unlockColdPassWithBiometric('lib').catch((error: unknown) => error)
    expect(isColdPassCancellation(cancelled)).toBe(true)
    expect(callBackend).toHaveBeenCalledWith('coldpass_unlock_biometric', { payload: { libraryId: 'lib' } })

    callBackend.mockRejectedValueOnce({ code: 'forbidden', message: 'La huella ya no abre ColdPass.', retryable: false })
    const invalidated = await unlockColdPassWithBiometric('lib').catch((error: unknown) => error)
    expect(isColdPassCancellation(invalidated)).toBe(false)
    expect(invalidated instanceof Error && invalidated.message).toBe('La huella ya no abre ColdPass.')
  })
})
