// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { FolderContextDialog } from './FolderContextDialog'
import { FileTree } from './FileTree'
import { DEFAULT_LIBRARY_CONTEXTS } from '../../services/contexts/libraryContexts'

function renderDialog(props: Partial<Parameters<typeof FolderContextDialog>[0]> = {}) {
  const onSave = vi.fn()
  render(
    <FolderContextDialog
      folderName="Trabajo"
      current="#Laboral"
      contexts={DEFAULT_LIBRARY_CONTEXTS}
      saving={false}
      error={null}
      onSave={onSave}
      onClose={() => {}}
      {...props}
    />,
  )
  return onSave
}

describe('FolderContextDialog', () => {
  afterEach(cleanup)

  it('starts on the folder context and saves the one picked', () => {
    const onSave = renderDialog()
    expect((screen.getByRole('radio', { name: '#Laboral' }) as HTMLInputElement).checked).toBe(true)
    const save = screen.getByRole('button', { name: 'Guardar' }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fireEvent.click(screen.getByRole('radio', { name: '#Publico' }))
    fireEvent.click(save)
    expect(onSave).toHaveBeenCalledWith('#Publico')
  })

  it('removes the context with «Sin contexto» and shows the backend error', () => {
    const onSave = renderDialog({ error: 'Esa carpeta no puede tener un contexto.' })
    fireEvent.click(screen.getByRole('radio', { name: 'Sin contexto' }))
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(onSave).toHaveBeenCalledWith(null)
    expect(screen.getByRole('alert').textContent).toBe('Esa carpeta no puede tener un contexto.')
  })

  it('stays closed without a folder', () => {
    renderDialog({ folderName: null })
    expect(screen.queryByRole('radiogroup')).toBeNull()
  })
})

describe('FileTree folder context', () => {
  afterEach(cleanup)

  it('shows the context to the right of the folder name', () => {
    const noop = () => {}
    render(
      <FileTree
        nodes={[
          { id: 'f1', name: 'Trabajo', path: 'C:/lib/Trabajo', type: 'folder', context: '#Laboral' },
          { id: 'f2', name: 'Otros', path: 'C:/lib/Otros', type: 'folder' },
        ]}
        rootPath="C:/lib"
        isSearchActive={false}
        searchMatchedFilePaths={new Set()}
        onToggleFolder={noop}
        onOpenFile={noop}
        pendingCreation={null}
        onSubmitPendingCreation={noop}
        onCancelPendingCreation={noop}
        renamingPath={null}
        onSubmitRename={noop}
        onCancelRename={noop}
        onNodeContextMenu={noop}
        onEmptyContextMenu={noop}
        onMoveNode={noop}
      />,
    )
    const badge = screen.getByTitle('Contexto de la carpeta: #Laboral')
    expect(badge.textContent).toBe('#Laboral')
    expect(badge.previousElementSibling?.textContent).toBe('Trabajo')
    expect(screen.getAllByText(/^#/)).toHaveLength(1)
  })
})
