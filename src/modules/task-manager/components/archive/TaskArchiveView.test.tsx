// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ConfirmationEngineProvider } from '../../../../context/confirmation/ConfirmationEngine'
import { TaskArchiveView } from './TaskArchiveView'
import type { TaskArchiveViewProps } from './TaskArchiveView'
import type { TaskArchiveRow } from '../../types/taskBoardTypes'

function row(index: number, overrides: Partial<TaskArchiveRow> = {}): TaskArchiveRow {
  return {
    taskPath: `task-mannager/default/T${index}.md`,
    path: `task-mannager/default/T${index}.md`,
    title: `Tarea ${index}`,
    board: 'default',
    group: 'Sprint Actual',
    groupColor: '#4fd1c5',
    priority: 'Media',
    project: null,
    assignees: [],
    hoursLabel: null,
    period: null,
    ...overrides,
  }
}

function rows(count: number): TaskArchiveRow[] {
  return Array.from({ length: count }, (_, index) => row(index + 1))
}

function renderArchive(props: Partial<TaskArchiveViewProps> = {}) {
  const onOpen = vi.fn()
  const onRestore = vi.fn<(paths: string[]) => Promise<void>>(async () => {})
  const onDelete = vi.fn<(paths: string[]) => Promise<void>>(async () => {})
  const list = props.rows ?? rows(3)
  const view = render(
    <ConfirmationEngineProvider>
      <TaskArchiveView
        kind="finished"
        rows={list}
        total={list.length}
        onOpen={onOpen}
        onRestore={onRestore}
        onDelete={onDelete}
        canEdit
        {...props}
      />
    </ConfirmationEngineProvider>,
  )
  return { ...view, onOpen, onRestore, onDelete }
}

const confirmButton = (label: string) => Array
  .from(document.querySelectorAll<HTMLButtonElement>('.notia-confirm-dialog-button'))
  .find((button) => button.textContent?.trim() === label)

const selectionBar = () => screen.getByRole('group', { name: 'Acciones sobre la selección' })

afterEach(cleanup)

describe('TaskArchiveView', () => {
  it('shows the rows with their group, priority and muted empty values', () => {
    const { container } = renderArchive({
      rows: [
        row(1, { hoursLabel: '6 / 16 h', period: '12 oct – 25 oct', priority: 'Urgente' }),
        row(2, { group: '', groupColor: null }),
      ],
      total: 56,
    })
    expect(screen.getByRole('heading', { name: 'Completadas' })).toBeDefined()
    expect(screen.getByText('56 tareas')).toBeDefined()
    expect(screen.getByText('Más recientes')).toBeDefined()
    expect(screen.getByText('6 / 16 h')).toBeDefined()
    expect(screen.getByText('12 oct – 25 oct')).toBeDefined()
    expect(screen.getByText('Sin grupo')).toBeDefined()
    expect(screen.getByText('—').className).toContain('is-empty')
    expect(screen.getByText('Sin fechas').className).toContain('is-empty')
    expect(container.querySelector('[data-priority="urgent"]')?.textContent).toBe('Urgente')
    expect(container.querySelectorAll('.tm-archive-icon.is-finished').length).toBe(2)
  })

  it('opens the ticket from its title', () => {
    const { onOpen } = renderArchive()
    fireEvent.click(screen.getByRole('button', { name: 'Tarea 2' }))
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ taskPath: 'task-mannager/default/T2.md' }))
  })

  it('selects rows, labels the selection and restores them together', async () => {
    const { onRestore } = renderArchive()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar Tarea 1' }))
    expect(within(selectionBar()).getByText('1 seleccionada')).toBeDefined()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar Tarea 3' }))
    expect(within(selectionBar()).getByText('2 seleccionadas')).toBeDefined()

    fireEvent.click(within(selectionBar()).getByRole('button', { name: /Recuperar/ }))
    await waitFor(() => expect(onRestore).toHaveBeenCalledWith(['task-mannager/default/T1.md', 'task-mannager/default/T3.md']))
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Acciones sobre la selección' })).toBeNull())
  })

  it('selects every row from the header and clears with the selection button', () => {
    renderArchive()
    const all = screen.getByRole<HTMLInputElement>('checkbox', { name: 'Seleccionar todas' })
    fireEvent.click(all)
    expect(within(selectionBar()).getByText('3 seleccionadas')).toBeDefined()
    expect(all.checked).toBe(true)
    fireEvent.click(all)
    expect(screen.queryByRole('group', { name: 'Acciones sobre la selección' })).toBeNull()

    fireEvent.click(all)
    fireEvent.click(screen.getByRole('button', { name: 'Limpiar selección' }))
    expect(screen.queryByRole('group', { name: 'Acciones sobre la selección' })).toBeNull()
  })

  it('asks before deleting the selection and does nothing when cancelled', async () => {
    const { onDelete } = renderArchive()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar Tarea 1' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar Tarea 2' }))

    fireEvent.click(within(selectionBar()).getByRole('button', { name: /Eliminar/ }))
    await waitFor(() => expect(confirmButton('Eliminar')).toBeDefined())
    expect(document.body.textContent).toContain('¿Eliminar 2 tareas?')
    fireEvent.click(confirmButton('Cancelar')!)
    await waitFor(() => expect(confirmButton('Cancelar')).toBeUndefined())
    expect(onDelete).not.toHaveBeenCalled()

    fireEvent.click(within(selectionBar()).getByRole('button', { name: /Eliminar/ }))
    await waitFor(() => expect(confirmButton('Eliminar')).toBeDefined())
    fireEvent.click(confirmButton('Eliminar')!)
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith(['task-mannager/default/T1.md', 'task-mannager/default/T2.md']))
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Acciones sobre la selección' })).toBeNull())
  })

  it('restores and deletes a single row from its actions', async () => {
    const { onRestore, onDelete } = renderArchive()
    fireEvent.click(screen.getByRole('button', { name: 'Recuperar Tarea 2' }))
    await waitFor(() => expect(onRestore).toHaveBeenCalledWith(['task-mannager/default/T2.md']))

    fireEvent.click(screen.getByRole('button', { name: 'Eliminar Tarea 3' }))
    await waitFor(() => expect(confirmButton('Eliminar')).toBeDefined())
    expect(document.body.textContent).toContain('¿Eliminar «Tarea 3»?')
    fireEvent.click(confirmButton('Eliminar')!)
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith(['task-mannager/default/T3.md']))
  })

  it('disables the actions while a request runs and keeps the selection when it fails', async () => {
    let reject: (error: Error) => void = () => {}
    const onRestore = vi.fn(() => new Promise<void>((_resolve, rejectPromise) => { reject = rejectPromise }))
    renderArchive({ onRestore })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar Tarea 1' }))
    fireEvent.click(within(selectionBar()).getByRole('button', { name: /Recuperar/ }))
    await waitFor(() => expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Recuperar Tarea 2' }).disabled).toBe(true))
    reject(new Error('falló'))
    await waitFor(() => expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Recuperar Tarea 2' }).disabled).toBe(false))
    expect(within(selectionBar()).getByText('1 seleccionada')).toBeDefined()
  })

  it('pages Completadas by 20 rows', () => {
    renderArchive({ rows: rows(45), total: 45 })
    expect(screen.getAllByRole('row').length).toBe(21)
    expect(screen.getByText('Mostrando 20 de 45')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: /Cargar 20 más/ }))
    expect(screen.getByText('Mostrando 40 de 45')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: /Cargar 5 más/ }))
    expect(screen.getByText('Mostrando 45 de 45')).toBeDefined()
    expect(screen.queryByRole('button', { name: /Cargar/ })).toBeNull()
  })

  it('shows every cancelled row with the origin note and icon', () => {
    const { container } = renderArchive({ kind: 'cancelled', rows: rows(25), total: 25 })
    expect(screen.getByRole('heading', { name: 'Canceladas' })).toBeDefined()
    expect(screen.getByText('Grupo de origen')).toBeDefined()
    expect(screen.getAllByRole('row').length).toBe(26)
    expect(screen.getByText('Mostrando 25 de 25')).toBeDefined()
    expect(screen.getByText('Recuperar devuelve la tarea a su grupo de origen.')).toBeDefined()
    expect(screen.queryByRole('button', { name: /Cargar/ })).toBeNull()
    expect(container.querySelectorAll('.tm-archive-icon.is-cancelled').length).toBe(25)
  })

  it('shows the empty state and the no-match state', () => {
    renderArchive({ rows: [], total: 0 })
    expect(screen.getByText('No hay tareas completadas.')).toBeDefined()
    expect(screen.queryByRole('table')).toBeNull()
    cleanup()

    renderArchive({ kind: 'cancelled', rows: [], total: 0 })
    expect(screen.getByText('No hay tareas canceladas.')).toBeDefined()
    cleanup()

    renderArchive({ rows: [], total: 12 })
    expect(screen.getByText('Sin coincidencias')).toBeDefined()
    expect(screen.getByText('12 tareas')).toBeDefined()
  })

  it('hides selection, restore and delete in read-only sessions', () => {
    renderArchive({ canEdit: false })
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.queryByRole('button', { name: /Recuperar/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Eliminar/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Tarea 1' })).toBeDefined()
  })
})
