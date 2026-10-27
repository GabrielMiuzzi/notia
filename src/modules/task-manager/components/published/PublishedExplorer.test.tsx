// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConfirmationEngineProvider } from '../../../../context/confirmation/ConfirmationEngine'
import { PublishedExplorer } from './PublishedExplorer'

const callBackend = vi.fn<(command: string, args: Record<string, unknown>) => Promise<unknown>>()
vi.mock('../../../../services/transport', () => ({
  callBackend: (command: string, args: Record<string, unknown>) => callBackend(command, args),
}))
vi.mock('../../services/taskManagerPublicationClient', () => ({
  subscribeTaskManagerPublicationChanges: () => () => undefined,
}))

const TREE = [
  {
    id: 'published-vault/Ideas',
    name: 'Ideas',
    path: 'published-vault/Ideas',
    type: 'folder',
    expanded: false,
    hasChildren: true,
    children: [{ id: 'published-vault/Ideas/Plan.md', name: 'Plan.md', path: 'published-vault/Ideas/Plan.md', type: 'file' }],
  },
  { id: 'published-vault/Raíz.md', name: 'Raíz.md', path: 'published-vault/Raíz.md', type: 'file' },
]

function renderExplorer() {
  const handlers = {
    onOpenNote: vi.fn(),
    onEntryRenamed: vi.fn(),
    onEntryDeleted: vi.fn(),
    onLibraryChanged: vi.fn(),
    onError: vi.fn(),
    onHide: vi.fn(),
  }
  render(
    <ConfirmationEngineProvider>
      <PublishedExplorer libraryId="lib" newNoteContext="#Laboral" activeBoard="default" {...handlers} />
    </ConfirmationEngineProvider>,
  )
  return handlers
}

describe('PublishedExplorer', () => {
  afterEach(cleanup)

  beforeEach(() => {
    callBackend.mockReset()
    callBackend.mockImplementation(async (command) => {
      if (command === 'library_read_directory') return TREE
      return { ok: true }
    })
  })

  it('lists the notes Rust gives, opens one and expands a folder', async () => {
    const { onOpenNote } = renderExplorer()
    await screen.findByText('Raíz')
    expect(callBackend).toHaveBeenCalledWith('library_read_directory', { payload: { libraryId: 'lib', path: 'published-vault' } })
    expect(screen.queryByText('Plan')).toBeNull()
    fireEvent.click(screen.getByText('Ideas'))
    expect(await screen.findByText('Plan')).toBeTruthy()
    fireEvent.click(screen.getByText('Plan'))
    expect(onOpenNote).toHaveBeenCalledWith('published-vault/Ideas/Plan.md')
  })

  it('creates a note at the root with the board context', async () => {
    const { onLibraryChanged } = renderExplorer()
    await screen.findByText('Raíz')
    fireEvent.click(screen.getByRole('button', { name: 'Nueva nota' }))
    const input = await screen.findByRole('textbox', { name: 'Nombre del archivo' })
    fireEvent.change(input, { target: { value: 'Acta' } })
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' })
    })
    await waitFor(() => expect(callBackend).toHaveBeenCalledWith('library_mutate_entry', {
      payload: { libraryId: 'lib', activeBoard: 'default', action: 'create', path: 'published-vault', name: expect.stringMatching(/^Acta(\.md)?$/), kind: 'note', contexto: '#Laboral' },
    }))
    await waitFor(() => expect(onLibraryChanged).toHaveBeenCalled())
  })

  it('renames from the context menu and tells the tabs', async () => {
    const { onEntryRenamed } = renderExplorer()
    const row = await screen.findByText('Raíz')
    fireEvent.contextMenu(row, { clientX: 10, clientY: 10 })
    fireEvent.click(await screen.findByText('Renombrar'))
    const input = await screen.findByRole('textbox')
    fireEvent.change(input, { target: { value: 'Base' } })
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' })
    })
    await waitFor(() => expect(callBackend).toHaveBeenCalledWith('library_mutate_entry', {
      payload: { libraryId: 'lib', activeBoard: 'default', action: 'rename', path: 'published-vault/Raíz.md', name: 'Base.md' },
    }))
    await waitFor(() => expect(onEntryRenamed).toHaveBeenCalledWith('published-vault/Raíz.md', 'published-vault/Base.md'))
  })

  it('hides itself from its header', async () => {
    const { onHide } = renderExplorer()
    await screen.findByText('Raíz')
    fireEvent.click(screen.getByRole('button', { name: 'Ocultar explorador' }))
    expect(onHide).toHaveBeenCalled()
  })

  it('shows the backend refusal instead of changing anything', async () => {
    callBackend.mockImplementation(async (command) => {
      if (command === 'library_read_directory') return TREE
      return { ok: false, error: 'La carpeta tiene notas de otros contextos: no se puede cambiar desde el tablero publicado.' }
    })
    const { onError, onEntryDeleted } = renderExplorer()
    const row = await screen.findByText('Ideas')
    fireEvent.contextMenu(row, { clientX: 10, clientY: 10 })
    fireEvent.click(await screen.findByText('Eliminar'))
    fireEvent.click(await screen.findByRole('button', { name: 'Eliminar' }))
    await waitFor(() => expect(onError).toHaveBeenCalledWith(expect.stringContaining('otros contextos')))
    expect(onEntryDeleted).not.toHaveBeenCalled()
  })
})
