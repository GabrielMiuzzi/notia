// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const { ensureLibraryConfigExists, pickLibraryDirectory } = vi.hoisted(() => ({
  ensureLibraryConfigExists: vi.fn(),
  pickLibraryDirectory: vi.fn(),
}))

vi.mock('../../services/libraries/libraryRuntime', () => ({
  pickLibraryDirectory,
}))

vi.mock('../../services/libraries/libraryConfig', () => ({
  ensureLibraryConfigExists,
}))

vi.mock('../../utils/uuid', () => ({
  generateUUID: () => 'library-id',
}))

import { LibraryManagerModal } from './LibraryManagerModal'

describe('LibraryManagerModal', () => {
  afterEach(() => {
    cleanup()
    pickLibraryDirectory.mockReset()
    ensureLibraryConfigExists.mockReset()
  })

  it('keeps the modal open while an Android touch opens the directory picker', async () => {
    let resolvePicker: ((value: null) => void) | undefined
    pickLibraryDirectory.mockReturnValue(new Promise<null>((resolve) => {
      resolvePicker = resolve
    }))
    const onClose = vi.fn()

    render(
      <LibraryManagerModal
        open
        libraries={[]}
        activeLibraryId={null}
        onLibraryAdded={vi.fn(async () => undefined)}
        onLibraryRemoved={vi.fn(async () => undefined)}
        onClose={onClose}
      />,
    )

    const button = screen.getByRole('button', { name: 'Agregar nueva libreria' })
    button.setPointerCapture = () => undefined
    button.hasPointerCapture = () => false
    button.releasePointerCapture = () => undefined

    fireEvent.pointerDown(button, {
      pointerId: 1,
      pointerType: 'touch',
      button: 0,
      clientX: 24,
      clientY: 24,
    })
    fireEvent.pointerUp(button, {
      pointerId: 1,
      pointerType: 'touch',
      button: 0,
      clientX: 24,
      clientY: 24,
    })

    await waitFor(() => expect(pickLibraryDirectory).toHaveBeenCalledOnce())
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(onClose).not.toHaveBeenCalled()

    resolvePicker?.(null)
  })

  it('does not close until the selected library has been persisted', async () => {
    pickLibraryDirectory.mockResolvedValue({
      name: 'Tablet',
      path: 'content://com.android.externalstorage.documents/tree/primary%3ANotas',
      androidTreeUri: 'content://com.android.externalstorage.documents/tree/primary%3ANotas',
    })
    ensureLibraryConfigExists.mockResolvedValue(undefined)
    let resolveAdd: (() => void) | undefined
    const onLibraryAdded = vi.fn(() => new Promise<void>((resolve) => {
      resolveAdd = resolve
    }))
    const onClose = vi.fn()

    render(
      <LibraryManagerModal
        open
        libraries={[]}
        activeLibraryId={null}
        onLibraryAdded={onLibraryAdded}
        onLibraryRemoved={vi.fn(async () => undefined)}
        onClose={onClose}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Agregar nueva libreria' }))

    await waitFor(() => expect(onLibraryAdded).toHaveBeenCalledOnce())
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Cargando archivos...' })).toBeTruthy()

    resolveAdd?.()
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
  })

  it('keeps the modal open and shows configuration errors', async () => {
    pickLibraryDirectory.mockResolvedValue({
      name: 'Tablet',
      path: 'content://com.android.externalstorage.documents/tree/primary%3ANotas',
      androidTreeUri: 'content://com.android.externalstorage.documents/tree/primary%3ANotas',
    })
    ensureLibraryConfigExists.mockRejectedValue(new Error('No se pudo escribir la configuracion.'))
    const onLibraryAdded = vi.fn(async () => undefined)
    const onClose = vi.fn()

    render(
      <LibraryManagerModal
        open
        libraries={[]}
        activeLibraryId={null}
        onLibraryAdded={onLibraryAdded}
        onLibraryRemoved={vi.fn(async () => undefined)}
        onClose={onClose}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Agregar nueva libreria' }))

    expect((await screen.findByRole('status')).textContent).toBe('No se pudo escribir la configuracion.')
    expect(onLibraryAdded).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })
})
