// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { BoardPeopleDrawer, type BoardPeopleDrawerProps } from './BoardPeopleDrawer'
import type { TaskPaletteColor } from '../../types/taskBoardTypes'
import type { Board } from '../../types/taskManagerTypes'

const PALETTE: TaskPaletteColor[] = [
  { name: 'Teal', color: '#4FD1C5' },
  { name: 'Periwinkle', color: '#6C8EFF' },
  { name: 'Violeta', color: '#A78BFA' },
  { name: 'Oro', color: '#D9B44A' },
]

const BOARD: Board = {
  name: 'default',
  color: '#6C8EFF',
  activityHoursPerDay: 9,
  contexto: '#Laboral',
  plan: {
    dayStartMinutes: 540,
    dayEndMinutes: 1080,
    workDays: [true, true, true, true, true, false, false],
    sprintWeeks: 2,
    sprintStartWeekday: 0,
    divisionsPerYear: 4,
    divisionPrefix: 'Q',
    yearStartMonth: 1,
  },
  members: [
    { name: 'Gabriel Miuzzi', color: '#4FD1C5', initials: 'GM', isOwner: true, isMe: true, taskCount: 5, role: 'Vos · Propietario' },
    { name: 'José Pérez', color: '#6C8EFF', initials: 'JP', isOwner: false, isMe: false, taskCount: 1, role: 'Miembro' },
  ],
  projects: [{ name: 'Rediseño', color: '#A78BFA', taskCount: 3 }],
  counts: { active: 9, inProgress: 2, pending: 7 },
  nextMemberColor: '#A78BFA',
  nextProjectColor: '#D9B44A',
}

function renderDrawer(overrides: Partial<BoardPeopleDrawerProps> = {}) {
  const props: BoardPeopleDrawerProps = {
    open: true,
    board: BOARD,
    palette: PALETTE,
    initialTab: 'people',
    onClose: vi.fn(),
    onAddMember: vi.fn(async () => {}),
    onRemoveMember: vi.fn(async () => {}),
    onAddProject: vi.fn(async () => {}),
    onRemoveProject: vi.fn(async () => {}),
    ...overrides,
  }
  const view = render(<BoardPeopleDrawer {...props} />)
  return { ...view, props }
}

describe('BoardPeopleDrawer', () => {
  afterEach(cleanup)

  it('renders nothing while closed', () => {
    renderDrawer({ open: false })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('lists the people with their tasks and roles; the owner cannot be removed', () => {
    renderDrawer()
    expect(screen.getByRole('dialog', { name: 'Personas y proyectos del tablero' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: /Personas/ }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByText('5 tareas asignadas')).toBeTruthy()
    expect(screen.getByText('1 tarea asignada')).toBeTruthy()
    expect(screen.getByText('Vos · Propietario')).toBeTruthy()
    expect(screen.getByText('Miembro')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Quitar a Gabriel Miuzzi del tablero' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Quitar a José Pérez del tablero' })).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Agregar persona' }))
  })

  it('adds a person with Enter and clears the field', async () => {
    const { props } = renderDrawer()
    const input = screen.getByRole('textbox', { name: 'Agregar persona' })
    fireEvent.change(input, { target: { value: '  Ana Gómez ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(props.onAddMember).toHaveBeenCalledWith('Ana Gómez'))
    await waitFor(() => expect((input as HTMLInputElement).value).toBe(''))
  })

  it('warns about a person already on the board, ignoring case and accents', () => {
    const { props } = renderDrawer()
    fireEvent.change(screen.getByRole('textbox', { name: 'Agregar persona' }), { target: { value: 'jose perez' } })
    expect(screen.getByText('Esa persona ya está en el tablero.')).toBeTruthy()
    const add = screen.getByRole('button', { name: 'Agregar' }) as HTMLButtonElement
    expect(add.disabled).toBe(true)
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Agregar persona' }), { key: 'Enter' })
    expect(props.onAddMember).not.toHaveBeenCalled()
  })

  it('shows the error when adding fails and keeps what was typed', async () => {
    renderDrawer({ onAddMember: vi.fn(async () => { throw new Error('El nombre no es válido.') }) })
    const input = screen.getByRole('textbox', { name: 'Agregar persona' })
    fireEvent.change(input, { target: { value: 'Ana' } })
    fireEvent.click(screen.getByRole('button', { name: 'Agregar' }))
    expect(await screen.findByText('El nombre no es válido.')).toBeTruthy()
    expect((input as HTMLInputElement).value).toBe('Ana')
  })

  it('removes a member and disables the buttons while it runs', async () => {
    let finish: () => void = () => {}
    const onRemoveMember = vi.fn(() => new Promise<void>((resolve) => { finish = resolve }))
    renderDrawer({ onRemoveMember })
    const remove = screen.getByRole('button', { name: 'Quitar a José Pérez del tablero' }) as HTMLButtonElement
    fireEvent.click(remove)
    expect(onRemoveMember).toHaveBeenCalledWith('José Pérez')
    expect(remove.disabled).toBe(true)
    finish()
    await waitFor(() => expect(remove.disabled).toBe(false))
  })

  it('adds a project with the next color preselected or the one picked', async () => {
    const { props } = renderDrawer({ initialTab: 'projects' })
    expect(screen.getByRole('tab', { name: /Proyectos/ }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByText('3 tareas')).toBeTruthy()
    expect(screen.getByRole('radio', { name: 'Oro' }).getAttribute('aria-checked')).toBe('true')

    const input = screen.getByRole('textbox', { name: 'Agregar proyecto' })
    fireEvent.change(input, { target: { value: 'Migración' } })
    fireEvent.click(screen.getByRole('button', { name: 'Agregar' }))
    await waitFor(() => expect(props.onAddProject).toHaveBeenCalledWith('Migración', '#D9B44A'))

    fireEvent.click(screen.getByRole('radio', { name: 'Periwinkle' }))
    fireEvent.change(input, { target: { value: 'Soporte' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(props.onAddProject).toHaveBeenLastCalledWith('Soporte', '#6C8EFF'))
  })

  it('follows the next project color the board gets', () => {
    const { rerender, props } = renderDrawer({ initialTab: 'projects' })
    rerender(<BoardPeopleDrawer {...props} board={{ ...BOARD, nextProjectColor: '#4FD1C5' }} />)
    expect(screen.getByRole('radio', { name: 'Teal' }).getAttribute('aria-checked')).toBe('true')
  })

  it('warns about a duplicate project and removes a project', async () => {
    const { props } = renderDrawer({ initialTab: 'projects' })
    fireEvent.change(screen.getByRole('textbox', { name: 'Agregar proyecto' }), { target: { value: 'rediseno' } })
    expect(screen.getByText('Ya existe un proyecto con ese nombre.')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Agregar' }) as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Eliminar el proyecto Rediseño' }))
    await waitFor(() => expect(props.onRemoveProject).toHaveBeenCalledWith('Rediseño'))
    expect(screen.getByText('Al eliminar un proyecto, sus tareas quedan sin proyecto.')).toBeTruthy()
  })

  it('shows the empty projects message', () => {
    renderDrawer({ initialTab: 'projects', board: { ...BOARD, projects: [] } })
    expect(screen.getByText('Todavía no hay proyectos en este tablero.')).toBeTruthy()
  })

  it('switches tabs with the arrow keys', () => {
    renderDrawer()
    const people = screen.getByRole('tab', { name: /Personas/ })
    fireEvent.keyDown(people, { key: 'ArrowRight' })
    expect(screen.getByRole('tab', { name: /Proyectos/ }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('textbox', { name: 'Agregar proyecto' })).toBeTruthy()
  })

  it('closes with Escape, the X and the overlay, and clears the fields', () => {
    const onClose = vi.fn()
    const { rerender, props, container } = renderDrawer({ onClose })
    fireEvent.change(screen.getByRole('textbox', { name: 'Agregar persona' }), { target: { value: 'Ana' } })

    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Agregar persona' }), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar panel' }))
    expect(onClose).toHaveBeenCalledTimes(2)

    const overlay = container.querySelector('.tbp-overlay')!
    fireEvent.click(overlay)
    expect(onClose).toHaveBeenCalledTimes(2)
    fireEvent.pointerDown(overlay)
    fireEvent.click(overlay)
    expect(onClose).toHaveBeenCalledTimes(3)

    rerender(<BoardPeopleDrawer {...props} open={false} />)
    rerender(<BoardPeopleDrawer {...props} open />)
    expect((screen.getByRole('textbox', { name: 'Agregar persona' }) as HTMLInputElement).value).toBe('')
  })
})
