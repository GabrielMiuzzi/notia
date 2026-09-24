// @vitest-environment happy-dom
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { TaskItem } from '../../types/taskManagerTypes'
import { TaskSourceDialog, type TaskSourceDialogState } from './TaskSourceDialog'

vi.mock('../../../../components/notia/hooks/useWikiLinkTargets', () => ({ useWikiLinkTargets: () => [] }))

vi.mock('../../../../components/notia/views/MarkdownView', () => ({
  MarkdownView: ({ source, lockedContextTag, onSourceChange, onOpenLinkedFile }: {
    source: string
    lockedContextTag?: string
    onSourceChange: (source: string) => void
    onOpenLinkedFile: (path: string) => void
  }) => (
    <div data-locked-context={lockedContextTag}>
      <textarea aria-label="Editor Markdown" value={source} onChange={(event) => onSourceChange(event.target.value)} />
      <button type="button" onClick={() => onOpenLinkedFile('Notas/relacionada.md')}>Abrir enlace</button>
    </div>
  ),
}))

const task = { filePath: 'Tareas/default/ode.md', path: 'Tareas/default/ode.md', fileName: 'ode.md', title: 'ODE propia', contexto: '#Laboral' } as TaskItem

function Harness({ initial, onSave, onOpenLinkedFile }: { initial: TaskSourceDialogState; onSave: (source: string) => void; onOpenLinkedFile: (path: string) => void }) {
  const [state, setState] = useState<TaskSourceDialogState | null>(initial)
  if (!state) return <p>Cerrado</p>
  return (
    <TaskSourceDialog
      state={state}
      onSourceChange={(source) => setState({ ...state, source })}
      onSave={() => onSave(state.source)}
      onClose={() => setState(null)}
      onOpenLinkedFile={onOpenLinkedFile}
    />
  )
}

const loaded = (source: string): TaskSourceDialogState => ({ task, originalSource: source, source, isLoading: false, isSaving: false, loadError: null })

describe('TaskSourceDialog', () => {
  afterEach(cleanup)

  it('does not offer to save when the task could not be read', () => {
    render(<Harness initial={{ ...loaded(''), loadError: 'No se pudo leer la tarea.' }} onSave={vi.fn()} onOpenLinkedFile={vi.fn()} />)
    expect(screen.getByRole('alert').textContent).toBe('No se pudo leer la tarea.')
    expect((screen.getByRole('button', { name: 'Guardar' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('edits the task in the notes editor and saves only after a change', async () => {
    const onSave = vi.fn()
    render(<Harness initial={loaded('---\nestado: "Pendiente"\n---\n\nCuerpo')} onSave={onSave} onOpenLinkedFile={vi.fn()} />)
    const editor = await screen.findByLabelText('Editor Markdown')
    expect(editor.parentElement?.getAttribute('data-locked-context')).toBe('#Laboral')
    const save = screen.getByRole('button', { name: 'Guardar' }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fireEvent.keyDown(editor, { key: 'o' })
    fireEvent.change(editor, { target: { value: '---\nestado: "Pendiente"\n---\n\nCuerpo editado' } })
    expect(save.disabled).toBe(false)
    fireEvent.click(save)
    expect(onSave).toHaveBeenCalledWith('---\nestado: "Pendiente"\n---\n\nCuerpo editado')
  })

  it('takes the editor rewrite on opening as the starting point, not as a change', async () => {
    render(<Harness initial={loaded('- item')} onSave={vi.fn()} onOpenLinkedFile={vi.fn()} />)
    const editor = await screen.findByLabelText('Editor Markdown')
    const save = screen.getByRole('button', { name: 'Guardar' }) as HTMLButtonElement
    // Milkdown emits its own style before anyone types.
    fireEvent.change(editor, { target: { value: '* item\n' } })
    expect(save.disabled).toBe(true)
    fireEvent.pointerDown(editor)
    fireEvent.change(editor, { target: { value: '* item editado\n' } })
    expect(save.disabled).toBe(false)
  })

  it('opens a linked file only when there are no unsaved changes', async () => {
    const onOpenLinkedFile = vi.fn()
    render(<Harness initial={loaded('Cuerpo')} onSave={vi.fn()} onOpenLinkedFile={onOpenLinkedFile} />)
    const editor = await screen.findByLabelText('Editor Markdown')
    fireEvent.keyDown(editor, { key: 's' })
    fireEvent.change(editor, { target: { value: 'Cuerpo con cambios' } })
    fireEvent.click(screen.getByRole('button', { name: 'Abrir enlace' }))
    expect(onOpenLinkedFile).not.toHaveBeenCalled()
    expect(screen.getByRole('status').textContent).toBe('Guardá o descartá los cambios antes de abrir un enlace.')

    fireEvent.change(screen.getByLabelText('Editor Markdown'), { target: { value: 'Cuerpo' } })
    fireEvent.click(screen.getByRole('button', { name: 'Abrir enlace' }))
    expect(onOpenLinkedFile).toHaveBeenCalledWith('Notas/relacionada.md')
    expect(screen.getByText('Cerrado')).toBeTruthy()
  })
})
