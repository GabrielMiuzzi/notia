// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { TaskManagementView } from './TaskManagementView'
import type { CpmRow, GanttBar, GanttRow, ManagementRequest, ManagementView } from '../../types/managementTypes'

const REQUEST: ManagementRequest = { divisionOffset: 0, rangeMode: 'auto', groupBy: 'task' }
const LETTERS = ['A', 'B', 'C'] as const
const path = (letter: string) => `Tareas/${letter}.md`

function bar(letter: string, critical: boolean): GanttBar {
  return {
    taskPath: path(letter), letter, x: 449, width: 26, top: 10, height: 30, label: `${letter} · 4 h`,
    tooltip: `${letter} · Tarea ${letter} · lun 19 oct · 09:00 → lun 19 oct · 13:00${critical ? ' · crítica' : ' · holgura 6 h'}`,
    critical, blocked: letter === 'C', clippedLeft: false, clippedRight: letter === 'C', delayMs: 160,
    wait: letter === 'B' ? { x: 448, width: 28, top: 10, height: 30, tooltip: 'Espera a Gabriel (4 h)' } : null,
    slack: critical ? null : { x: 476, width: 40, top: 14, height: 22, tooltip: 'Holgura: 6 h' },
  }
}

function ganttRow(letter: string, critical: boolean): GanttRow {
  return {
    key: path(letter), kind: 'task', height: 50, letter, critical, title: `Tarea ${letter}`,
    sub: 'lun 19 oct · 09:00 → lun 19 oct · 13:00',
    avatars: [{ name: 'Gabriel Díaz', initials: 'GD', color: '#4FD1C5' }], person: null, unassigned: false,
    taskPaths: [path(letter)], bars: [bar(letter, critical)],
  }
}

function tableRow(letter: string, index: number): CpmRow {
  const critical = letter !== 'C'
  return {
    taskPath: path(letter), letter, title: `Tarea ${letter}`, group: 'Sprint actual', groupColor: '#4FD1C5',
    unestimatedNote: letter === 'C' ? 'sin estimar (9 h por defecto)' : null,
    people: letter === 'C' ? [] : [{ name: 'Gabriel Díaz', initials: 'GD', color: '#4FD1C5' }],
    unassignedLabel: letter === 'C' ? 'Sin asignar' : null,
    remaining: '4 h',
    predecessors: letter === 'B' ? ['A'] : [],
    dependencyPaths: letter === 'B' ? [path('A')] : [],
    cycleLetters: letter === 'A' ? ['B'] : [],
    editLabel: `Editar predecesoras de ${letter}`, popoverTitle: `${letter} empieza después de`,
    popoverLabel: `Predecesoras de ${letter}`, popoverAbove: false,
    startLabel: 'lun 19 oct · 09:00', waitLabel: letter === 'B' ? 'Espera a Gabriel' : null,
    endLabel: 'lun 19 oct · 13:00', lateStartLabel: 'lun 19 oct · 09:00', slackLabel: critical ? '0 h' : '6 h',
    critical, routeLabel: critical ? 'Crítica' : 'Con holgura', delayMs: index * 35,
  }
}

function makeView(overrides: Partial<ManagementView> = {}): ManagementView {
  return {
    empty: false,
    emptyLabel: 'No hay tareas activas para planificar en este tablero.',
    hoursPerDay: '9',
    divisionOffset: 0,
    rangeMode: 'auto',
    groupBy: 'task',
    kpis: [
      { kind: 'range', label: 'Rango', value: 'Sprint 21', sub: '12 oct – 25 oct · 5 días hábiles por delante', tone: 'primary' },
      { kind: 'team-load', label: 'Carga del equipo', value: '98 h / 90 h', sub: '109% de 2 personas × 9 h/día', tone: 'coral' },
      { kind: 'most-loaded', label: 'Más cargado', value: 'Gabriel · 40 h', sub: '89% de su capacidad en el rango', tone: 'amber' },
      { kind: 'finish', label: 'Fin de lo planificado', value: 'lun 19 oct', sub: '17:00 · ruta crítica A → B', tone: 'coral' },
    ],
    divisions: {
      title: 'Q4 2026', fiscalYearLabel: '2026', previousOffset: -1, nextOffset: 1, showToday: false,
      tabs: ['Q1', 'Q2', 'Q3', 'Q4'].map((label, index) => ({
        label, tooltip: index === 3 ? '1 oct – 31 dic' : 'otro', offset: index - 3, selected: index === 3, current: index === 3,
      })),
    },
    range: {
      title: 'Sprint 21', heading: 'Gantt · Sprint 21 · Q4 2026',
      subtitle: '12 oct – 25 oct · ajustado a los sprints con tareas', wholeDivision: false, days: 14,
      modes: [
        { mode: 'auto', label: 'Auto · 1 sprint', tooltip: 'Elige solo entre los sprints con tareas y el Q completo', selected: true },
        { mode: 'sprints', label: 'Sprints', tooltip: 'Solo los sprints que ocupan las tareas', selected: false },
        { mode: 'division', label: 'Q completo', tooltip: 'Toda la división', selected: false },
      ],
    },
    gantt: {
      width: 896, pxPerDay: 64, daily: true, headLabel: 'Tarea', countLabel: '3 tareas',
      groupOptions: [
        { groupBy: 'task', label: 'Por tarea', selected: true },
        { groupBy: 'person', label: 'Por persona', selected: false },
      ],
      months: [{ x: 0, width: 896, label: 'octubre 2026' }],
      sprints: [{ x: 2, width: 892, label: 'Sprint 21 · actual', tooltip: 'Sprint 21 · 12 oct – 25 oct', kind: 'current' }],
      ticks: [{ x: 448, width: 64, top: 'lun', bottom: '19', today: true, weekend: false }],
      weekends: [{ x: 320, width: 64 }],
      sprintLines: [],
      nowX: 448,
      rows: LETTERS.map((letter) => ganttRow(letter, letter !== 'C')),
      noRowsLabel: 'No hay tareas planificadas en Q4 2026.',
      outside: { text: '1 tarea está planificada después de Q4.', laterLabel: 'Ver Q1 2027 →', nextOffset: 1 },
    },
    network: {
      width: 672, height: 280, nodeWidth: 184, nodeHeight: 100, endpointSize: 56,
      start: { x: 28, y: 112, label: 'Inicio', delayMs: 60 },
      finish: { x: 616, y: 112, label: 'Fin', delayMs: 360 },
      nodes: LETTERS.map((letter, index) => ({
        taskPath: path(letter), letter, title: `Tarea ${letter}`, tooltip: `Tarea ${letter} · GD`, x: 140 + index * 236, y: 28,
        level: index, critical: letter !== 'C', unestimated: letter === 'C', earlyStart: '0', duration: '4',
        earlyFinish: '4', lateStart: '0', slack: letter === 'C' ? '6' : '0', lateFinish: '4', delayMs: 120,
      })),
      edges: [
        { key: 'A>B:r', from: path('A'), to: path('B'), kind: 'resource', critical: true, d: 'M324 78 C350 78 350 140 373 140', delayMs: 420 },
        { key: 'inicio>C', from: null, to: path('C'), kind: 'dependency', critical: false, d: 'M84 140 C110 140 110 202 137 202', delayMs: 455 },
      ],
    },
    table: {
      description: 'Fechas calculadas con las horas restantes, la jornada de 9 h y una tarea por persona a la vez. Editá las predecesoras para recalcular.',
      cycleNote: 'Crearía un ciclo',
      candidates: LETTERS.map((letter) => ({ taskPath: path(letter), letter, title: `Tarea ${letter}` })),
      rows: LETTERS.map((letter, index) => tableRow(letter, index)),
    },
    criticalPath: 'A → B',
    ...overrides,
  }
}

function renderView(props: Partial<Parameters<typeof TaskManagementView>[0]> = {}) {
  const onRequestChange = vi.fn<(next: ManagementRequest) => void>()
  const onSetPredecessors = vi.fn<(taskPath: string, dependencyPaths: string[]) => Promise<void>>(async () => {})
  const onOpenTask = vi.fn<(taskPath: string) => void>()
  const utils = render(
    <TaskManagementView view={makeView()} loading={false} error={null} request={REQUEST}
      onRequestChange={onRequestChange} onSetPredecessors={onSetPredecessors} onOpenTask={onOpenTask} canEdit {...props} />,
  )
  return { ...utils, onRequestChange, onSetPredecessors, onOpenTask }
}

afterEach(cleanup)

describe('TaskManagementView', () => {
  it('paints the KPIs, Gantt, network and table that Rust computed', () => {
    const { getByText, getAllByText, getByRole, container } = renderView()
    expect(getByText('98 h / 90 h').getAttribute('data-tone')).toBe('coral')
    expect(getByText('Gabriel · 40 h').getAttribute('data-tone')).toBe('amber')
    expect(getByRole('heading', { name: 'Gantt · Sprint 21 · Q4 2026' })).toBeTruthy()
    expect(getByText('12 oct – 25 oct · ajustado a los sprints con tareas')).toBeTruthy()
    expect(getByText('Sprint 21 · actual').getAttribute('data-kind')).toBe('current')
    const firstBar = getByRole('button', { name: /^A · Tarea A · lun/ })
    expect(firstBar.style.left).toBe('449px')
    expect(firstBar.style.width).toBe('26px')
    expect(container.querySelector('.tm-mgmt__slack')?.getAttribute('title')).toBe('Holgura: 6 h')
    expect(container.querySelector('.tm-mgmt__wait')?.getAttribute('title')).toBe('Espera a Gabriel (4 h)')
    expect(container.querySelector('.tm-mgmt__now')?.getAttribute('style')).toContain('left: 448px')
    expect(getByRole('heading', { name: 'Red CPM' })).toBeTruthy()
    expect(container.querySelectorAll('.tm-mgmt__edge')).toHaveLength(2)
    expect(container.querySelector('.tm-mgmt__edge--critical')?.getAttribute('d')).toBe('M324 78 C350 78 350 140 373 140')
    expect(getByText('Inicio', { selector: '.tm-mgmt__endpoint' })).toBeTruthy()
    expect(getByRole('heading', { name: 'Tabla CPM' })).toBeTruthy()
    expect(getByText('Espera a Gabriel')).toBeTruthy()
    expect(getByText('· sin estimar (9 h por defecto)')).toBeTruthy()
    expect(getAllByText('Crítica')).toHaveLength(2)
    expect(getByText('Con holgura', { selector: '.tm-mgmt__route' }).hasAttribute('data-critical')).toBe(false)
  })

  it('sends the division, range and grouping the person picks', () => {
    const { getByRole, queryByRole, onRequestChange, rerender } = renderView()
    expect(queryByRole('button', { name: 'Hoy' })).toBeNull()
    fireEvent.click(getByRole('button', { name: 'Q1' }))
    expect(onRequestChange).toHaveBeenLastCalledWith({ ...REQUEST, divisionOffset: -3 })
    fireEvent.click(getByRole('button', { name: 'División siguiente' }))
    expect(onRequestChange).toHaveBeenLastCalledWith({ ...REQUEST, divisionOffset: 1 })
    fireEvent.click(getByRole('button', { name: 'Sprints' }))
    expect(onRequestChange).toHaveBeenLastCalledWith({ ...REQUEST, rangeMode: 'sprints' })
    fireEvent.click(getByRole('button', { name: 'Por persona' }))
    expect(onRequestChange).toHaveBeenLastCalledWith({ ...REQUEST, groupBy: 'person' })
    fireEvent.click(getByRole('button', { name: 'Ver Q1 2027 →' }))
    expect(onRequestChange).toHaveBeenLastCalledWith({ ...REQUEST, divisionOffset: 1 })
    expect(getByRole('button', { name: /Q4/ }).getAttribute('aria-pressed')).toBe('true')

    const away = makeView({ divisions: { ...makeView().divisions, showToday: true } })
    rerender(
      <TaskManagementView view={away} loading={false} error={null} request={{ ...REQUEST, divisionOffset: 2 }}
        onRequestChange={onRequestChange} onSetPredecessors={vi.fn()} canEdit />,
    )
    fireEvent.click(getByRole('button', { name: 'Hoy' }))
    expect(onRequestChange).toHaveBeenLastCalledWith({ ...REQUEST, divisionOffset: 0 })
  })

  it('edits predecessors in a popover that disables options closing a cycle', async () => {
    const { getByRole, queryByRole, onSetPredecessors } = renderView()
    const edit = getByRole('button', { name: 'Editar predecesoras de A' })
    fireEvent.click(edit)
    const dialog = getByRole('dialog', { name: 'Predecesoras de A' })
    expect(edit.getAttribute('aria-expanded')).toBe('true')
    expect(within(dialog).getByText('A empieza después de')).toBeTruthy()
    const cycle = within(dialog).getByRole('button', { name: /Tarea B/ }) as HTMLButtonElement
    expect(cycle.disabled).toBe(true)
    expect(within(dialog).getByText('Crearía un ciclo')).toBeTruthy()
    const free = within(dialog).getByRole('button', { name: /Tarea C/ }) as HTMLButtonElement
    expect(free.disabled).toBe(false)
    expect(document.activeElement).toBe(free)
    fireEvent.click(free)
    await waitFor(() => expect(onSetPredecessors).toHaveBeenCalledWith(path('A'), [path('C')]))
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(edit)

    fireEvent.click(getByRole('button', { name: 'Editar predecesoras de B' }))
    const checked = within(getByRole('dialog')).getByRole('button', { name: /Tarea A/ })
    expect(checked.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(checked)
    await waitFor(() => expect(onSetPredecessors).toHaveBeenLastCalledWith(path('B'), []))
    fireEvent.click(within(getByRole('dialog')).getByRole('button', { name: 'Listo' }))
    expect(queryByRole('dialog')).toBeNull()
  })

  it('shows the error when Rust rejects a predecessor', async () => {
    const onSetPredecessors = vi.fn(async () => { throw new Error('Crearía un ciclo entre A y C.') })
    const { getByRole, findByRole } = renderView({ onSetPredecessors })
    fireEvent.click(getByRole('button', { name: 'Editar predecesoras de A' }))
    fireEvent.click(within(getByRole('dialog')).getByRole('button', { name: /Tarea C/ }))
    expect((await findByRole('alert')).textContent).toBe('Crearía un ciclo entre A y C.')
  })

  it('hides the predecessor editing while read-only', () => {
    const { queryByRole } = renderView({ canEdit: false })
    expect(queryByRole('button', { name: 'Editar predecesoras de A' })).toBeNull()
  })

  it('highlights the same task in the Gantt, network and table', () => {
    const { container, getByRole } = renderView()
    const tableRow = container.querySelectorAll('.tm-mgmt__trow')[2]
    fireEvent.pointerEnter(tableRow, { pointerType: 'mouse' })
    expect(container.querySelectorAll('.tm-mgmt__gantt-row')[2].hasAttribute('data-highlight')).toBe(true)
    const node = getByRole('button', { name: 'C · Tarea C · GD' })
    expect(node.hasAttribute('data-active')).toBe(true)
    expect(container.querySelector('.tm-mgmt__edge--active')).not.toBeNull()
    fireEvent.pointerLeave(tableRow, { pointerType: 'mouse' })
    expect(node.hasAttribute('data-active')).toBe(false)

    // A tap toggles the highlight instead of opening the task.
    const bar = getByRole('button', { name: /^A · Tarea A · lun/ })
    fireEvent.pointerDown(bar, { pointerType: 'touch' })
    fireEvent.click(bar, { detail: 1 })
    expect(tableRow.hasAttribute('data-highlight')).toBe(false)
    expect(container.querySelectorAll('.tm-mgmt__trow')[0].hasAttribute('data-highlight')).toBe(true)
    fireEvent.pointerDown(bar, { pointerType: 'touch' })
    fireEvent.click(bar, { detail: 1 })
    expect(container.querySelectorAll('.tm-mgmt__trow')[0].hasAttribute('data-highlight')).toBe(false)
  })

  it('opens the task with a mouse click or the keyboard', () => {
    const { getByRole, onOpenTask } = renderView()
    const node = getByRole('button', { name: 'B · Tarea B · GD' })
    fireEvent.pointerDown(node, { pointerType: 'mouse' })
    fireEvent.click(node, { detail: 1 })
    expect(onOpenTask).toHaveBeenLastCalledWith(path('B'))
    fireEvent.click(getByRole('button', { name: 'Tarea C' }))
    expect(onOpenTask).toHaveBeenLastCalledWith(path('C'))
  })

  it('shows loading, error and empty states', () => {
    const { getByRole, getByText, rerender, container } = render(
      <TaskManagementView view={null} loading error={null} request={REQUEST} onRequestChange={vi.fn()}
        onSetPredecessors={vi.fn()} canEdit />,
    )
    expect(getByRole('status').textContent).toBe('Calculando el plan…')
    rerender(
      <TaskManagementView view={null} loading={false} error="No se pudo planificar." request={REQUEST}
        onRequestChange={vi.fn()} onSetPredecessors={vi.fn()} canEdit />,
    )
    expect(getByRole('alert').textContent).toBe('No se pudo planificar.')
    rerender(
      <TaskManagementView view={makeView({ empty: true, kpis: [] })} loading={false} error={null} request={REQUEST}
        onRequestChange={vi.fn()} onSetPredecessors={vi.fn()} canEdit />,
    )
    expect(getByText('No hay tareas activas para planificar en este tablero.')).toBeTruthy()
    expect(container.querySelector('.tm-mgmt__gantt')).toBeNull()
  })

  it('shows the no-rows label when the division has no planned task', () => {
    const base = makeView()
    const { getByText } = renderView({ view: makeView({ gantt: { ...base.gantt, rows: [], outside: null } }) })
    expect(getByText('No hay tareas planificadas en Q4 2026.')).toBeTruthy()
  })
})
