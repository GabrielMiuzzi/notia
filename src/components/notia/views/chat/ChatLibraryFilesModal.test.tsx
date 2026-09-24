// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

const { loadLibraryFileOptions, loadLibraryFolderOptions } = vi.hoisted(() => ({
  loadLibraryFileOptions: vi.fn(),
  loadLibraryFolderOptions: vi.fn(),
}))

vi.mock('../../../../services/chat/chatAttachmentRuntime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../services/chat/chatAttachmentRuntime')>()),
  loadLibraryFileOptions,
  loadLibraryFolderOptions,
}))

import { ChatLibraryFilesModal } from './ChatLibraryFilesModal'

const library = { id: 'library-1', name: 'gaia', path: 'C:/gaia' }

describe('ChatLibraryFilesModal', () => {
  afterEach(() => {
    cleanup()
    loadLibraryFileOptions.mockReset()
    loadLibraryFolderOptions.mockReset()
  })

  it('shows the library files once they load instead of staying on the loading state', async () => {
    loadLibraryFileOptions.mockResolvedValue([
      { path: 'notas/plan.md', name: 'plan.md', relativePath: 'notas/plan.md' },
      { path: 'notas/ideas.md', name: 'ideas.md', relativePath: 'notas/ideas.md' },
    ])

    render(
      <ChatLibraryFilesModal
        open
        library={library}
        selectedPaths={[]}
        contextMode="direct"
        onClose={vi.fn()}
        onApply={vi.fn()}
      />,
    )

    expect(await screen.findByText('plan.md')).toBeTruthy()
    expect(screen.queryByText('Cargando archivos de la librería...')).toBeNull()
    expect(loadLibraryFileOptions).toHaveBeenCalledTimes(1)

    fireEvent.change(screen.getByPlaceholderText('Buscar archivos por nombre...'), { target: { value: 'idea' } })
    expect(screen.getByText('ideas.md')).toBeTruthy()
    expect(screen.queryByText('plan.md')).toBeNull()
  })

  it('lists folders with their file count and applies the chosen ones', async () => {
    loadLibraryFolderOptions.mockResolvedValue([
      { path: 'C:/gaia/notas', name: 'notas', relativePath: 'notas', fileCount: 3 },
      { path: 'C:/gaia/notas/2026', name: '2026', relativePath: 'notas/2026', fileCount: 1 },
    ])
    const onApply = vi.fn()

    render(
      <ChatLibraryFilesModal
        kind="folders"
        open
        library={library}
        selectedPaths={[]}
        contextMode="direct"
        onClose={vi.fn()}
        onApply={onApply}
      />,
    )

    expect(await screen.findByText('notas · 3 archivos')).toBeTruthy()
    expect(screen.getByText('Carpetas de la librería')).toBeTruthy()
    expect(loadLibraryFileOptions).not.toHaveBeenCalled()

    fireEvent.click(screen.getAllByRole('checkbox')[0])
    fireEvent.click(screen.getByText('Aplicar'))
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ selectedPaths: ['C:/gaia/notas'] }))
  })
})
