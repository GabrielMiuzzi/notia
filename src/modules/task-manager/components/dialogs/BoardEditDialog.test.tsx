// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { TaskBoardPlan, TaskBoardPlanPreview, TaskPaletteColor } from '../../types/taskBoardTypes'
import type { Board } from '../../types/taskManagerTypes'

const readBoardPlanPreview = vi.hoisted(() => vi.fn())

vi.mock('../../services/taskManagerService', () => ({ readBoardPlanPreview }))

import { BoardEditDialog, type BoardEditDialogProps } from './BoardEditDialog'

const PALETTE: TaskPaletteColor[] = [
  { name: 'Teal', color: '#4FD1C5' },
  { name: 'Periwinkle', color: '#6C8EFF' },
  { name: 'Violeta', color: '#A78BFA' },
]

const PLAN: TaskBoardPlan = {
  dayStartMinutes: 540,
  dayEndMinutes: 1080,
  workDays: [true, true, true, true, true, false, false],
  sprintWeeks: 2,
  sprintStartWeekday: 0,
  divisionsPerYear: 4,
  divisionPrefix: 'Q',
  yearStartMonth: 1,
}

const BOARD: Board = {
  name: 'Trabajo',
  color: '#6C8EFF',
  activityHoursPerDay: 9,
  contexto: '#Laboral',
  plan: PLAN,
  members: [],
  projects: [],
  counts: { active: 0, inProgress: 0, pending: 0 },
  nextMemberColor: '#4FD1C5',
  nextProjectColor: '#4FD1C5',
}

const CONTEXTS = [
  { tag: '#Laboral', color: '#2563EB' },
  { tag: '#Estudiantil', color: '#9333EA' },
  { tag: '#Personal', color: '#16A34A' },
]

const PREVIEW: TaskBoardPlanPreview = {
  summary: 'Trabajo · #Laboral · 09:00–18:00 · sprints de 2 sem · 4 Q',
  workday: {
    title: 'Jornada laboral',
    hint: 'Horario en el que trabajás este tablero.',
    daysTitle: 'Días laborables',
    startLabel: '09:00',
    endLabel: '18:00',
    hoursPerDay: '9',
    hoursPerWeek: '45 h por semana',
    nowFraction: 0.5,
    presets: [
      { label: 'Completa 9–18', startMinutes: 540, endMinutes: 1080, active: true },
      { label: 'Fin de semana 10–14', startMinutes: 600, endMinutes: 840, workDays: [false, false, false, false, false, true, true], active: false },
    ],
  },
  sprints: {
    weeksLabel: 'semanas',
    yearNote: '26 sprints en el año · la numeración se reinicia con el año.',
    rows: [
      { number: 21, label: 'Sprint 21', range: '12 oct – 25 oct', badgeKind: 'current', badge: 'Actual' },
      { number: 22, label: 'Sprint 22', range: '26 oct – 8 nov', badgeKind: 'next', badge: 'Siguiente' },
      { number: 23, label: 'Sprint 23', range: '9 nov – 22 nov', badgeKind: 'later', badge: 'Después' },
    ],
  },
  divisions: {
    unit: 'trimestres',
    yearLabel: 'Año 2026',
    todayLabel: 'Hoy: Q4',
    sprintLabel: ' · Sprint 21 de 26',
    bars: [
      { label: 'Q1', days: 90, current: false, tooltip: '1 ene – 31 mar' },
      { label: 'Q2', days: 91, current: false, tooltip: '1 abr – 30 jun' },
      { label: 'Q3', days: 92, current: false, tooltip: '1 jul – 30 sep' },
      { label: 'Q4', days: 92, current: true, tooltip: '1 oct – 31 dic' },
    ],
    sprintTicks: [0, 0.5],
    todayFraction: 0.79,
    months: ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'],
    duration: 'Cada Q dura ≈ 3 meses',
    sprintsPerDivision: '≈ 6,5 sprints por Q',
    current: 'Q4: 1 oct – 31 dic',
  },
}

type SaveValue = Parameters<BoardEditDialogProps['onSave']>[0]

function renderDialog(overrides: Partial<BoardEditDialogProps> = {}) {
  const onClose = vi.fn()
  const onSave = vi.fn<(value: SaveValue) => Promise<void>>(async () => {})
  const props: BoardEditDialogProps = {
    open: true,
    mode: 'edit',
    board: BOARD,
    palette: PALETTE,
    contexts: CONTEXTS,
    context: { libraryId: 'lib', libraryUserId: 'user' },
    lockNameAndColor: false,
    onClose,
    onSave,
    ...overrides,
  }
  const view = render(<BoardEditDialog {...props} />)
  return { ...view, onClose, onSave, props }
}

function lastPreviewRequest() {
  const calls = readBoardPlanPreview.mock.calls
  return calls[calls.length - 1]?.[1] as { boardName: string; contexto: string; plan: TaskBoardPlan } | undefined
}

describe('BoardEditDialog', () => {
  beforeEach(() => {
    readBoardPlanPreview.mockReset()
    readBoardPlanPreview.mockResolvedValue(PREVIEW)
  })

  afterEach(cleanup)

  it('renders nothing while closed', () => {
    renderDialog({ open: false })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('asks Rust for the preview of the edited plan and paints it', async () => {
    renderDialog()
    await waitFor(() => expect(readBoardPlanPreview).toHaveBeenCalledTimes(1))
    expect(readBoardPlanPreview.mock.calls[0][0]).toEqual({ libraryId: 'lib', libraryUserId: 'user' })
    expect(lastPreviewRequest()).toEqual({ boardName: 'Trabajo', contexto: '#Laboral', plan: PLAN })
    expect(await screen.findByText('Jornada laboral')).toBeTruthy()
    expect(screen.getByText('45 h por semana')).toBeTruthy()
    expect(screen.getByText('Sprint 22')).toBeTruthy()
    expect(screen.getByText('Q4: 1 oct – 31 dic')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Alargar sprint' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Miércoles' }))
    fireEvent.click(screen.getByRole('button', { name: 'Meses' }))
    await waitFor(() => expect(lastPreviewRequest()?.plan).toEqual({
      ...PLAN,
      sprintWeeks: 3,
      sprintStartWeekday: 2,
      divisionsPerYear: 12,
    }))
  })

  it('applies a preset with its days and marks the changes as unsaved', async () => {
    renderDialog()
    expect(screen.queryByText('Cambios sin guardar')).toBeNull()
    expect((screen.getByRole('button', { name: 'Guardar cambios' }) as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(await screen.findByRole('button', { name: 'Fin de semana 10–14' }))
    expect(screen.getByText('Cambios sin guardar')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Sábado' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Lunes' }).getAttribute('aria-pressed')).toBe('false')
    await waitFor(() => expect(lastPreviewRequest()?.plan).toEqual({
      ...PLAN,
      dayStartMinutes: 600,
      dayEndMinutes: 840,
      workDays: [false, false, false, false, false, true, true],
    }))

    fireEvent.click(screen.getByRole('button', { name: 'Completa 9–18' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sábado' }))
    fireEvent.click(screen.getByRole('button', { name: 'Domingo' }))
    for (const day of ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes']) {
      fireEvent.click(screen.getByRole('button', { name: day }))
    }
    expect(screen.queryByText('Cambios sin guardar')).toBeNull()
  })

  it('keeps the start of the workday before its end on the 24 h bar', async () => {
    renderDialog()
    const start = screen.getByRole('slider', { name: /^Inicio de/ })
    const end = screen.getByRole('slider', { name: /^Fin de/ })
    fireEvent.change(start, { target: { value: '40' } })
    await waitFor(() => expect(lastPreviewRequest()?.plan.dayStartMinutes).toBe(1050))
    fireEvent.change(end, { target: { value: '10' } })
    await waitFor(() => expect(lastPreviewRequest()?.plan.dayEndMinutes).toBe(1080))
  })

  it('sends the edited value and shows «Guardado»', async () => {
    const { onSave } = renderDialog()
    fireEvent.change(screen.getByRole('textbox', { name: 'Nombre del tablero' }), { target: { value: '  Oficina ' } })
    fireEvent.click(screen.getByRole('radio', { name: 'Violeta' }))
    fireEvent.click(screen.getByRole('radio', { name: /#Estudiantil/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(onSave.mock.calls[0][0]).toEqual({ name: 'Oficina', color: '#A78BFA', contexto: '#Estudiantil', plan: PLAN })
    expect(await screen.findByText('Guardado')).toBeTruthy()
    expect(screen.queryByText('Cambios sin guardar')).toBeNull()
  })

  it('stays open with the error when saving fails', async () => {
    const onSave = vi.fn(async () => { throw new Error('Ya existe un tablero con ese nombre.') })
    const { onClose } = renderDialog({ onSave })
    fireEvent.change(screen.getByRole('textbox', { name: 'Nombre del tablero' }), { target: { value: 'Casa' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))

    expect(await screen.findByText('Ya existe un tablero con ese nombre.')).toBeTruthy()
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('locks the name and color of the default board', () => {
    renderDialog({ board: { ...BOARD, name: 'default' }, lockNameAndColor: true })
    expect((screen.getByRole('textbox', { name: 'Nombre del tablero' }) as HTMLInputElement).disabled).toBe(true)
    for (const swatch of PALETTE) {
      expect((screen.getByRole('radio', { name: swatch.name }) as HTMLButtonElement).disabled).toBe(true)
    }
    expect((screen.getByRole('radio', { name: /#Personal/ }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('starts a new board with the defaults and #Personal', async () => {
    renderDialog({ mode: 'create', board: null })
    expect(screen.getByRole('heading', { name: 'Nuevo tablero' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: 'Teal' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('radio', { name: /#Personal/ }).getAttribute('aria-checked')).toBe('true')
    await waitFor(() => expect(lastPreviewRequest()).toEqual({ boardName: 'Sin nombre', contexto: '#Personal', plan: PLAN }))
  })

  it('adds a context of its own from the inline field', async () => {
    renderDialog()
    fireEvent.click(screen.getByRole('button', { name: 'Nuevo' }))
    const input = screen.getByRole('textbox', { name: 'Nombre del nuevo contexto' })
    fireEvent.change(input, { target: { value: 'Mi #viaje' } })
    expect((input as HTMLInputElement).value).toBe('Miviaje')
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(screen.getByRole('radio', { name: /#Miviaje/ }).getAttribute('aria-checked')).toBe('true')
    await waitFor(() => expect(lastPreviewRequest()?.contexto).toBe('#Miviaje'))

    fireEvent.click(screen.getByRole('button', { name: 'Nuevo' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Nombre del nuevo contexto' }), { target: { value: 'laboral' } })
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Nombre del nuevo contexto' }), { key: 'Enter' })
    expect(screen.getByRole('radio', { name: /#Laboral/ }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getAllByRole('radio', { name: /#Laboral/ })).toHaveLength(1)
  })

  it('cancels the new context with Escape without closing the dialog', () => {
    const { onClose } = renderDialog()
    fireEvent.click(screen.getByRole('button', { name: 'Nuevo' }))
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Nombre del nuevo contexto' }), { key: 'Escape' })
    expect(screen.queryByRole('textbox', { name: 'Nombre del nuevo contexto' })).toBeNull()
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('shows the preview error inline and keeps the last preview', async () => {
    renderDialog()
    expect(await screen.findByText('Sprint 21')).toBeTruthy()
    readBoardPlanPreview.mockRejectedValueOnce(new Error('Elegí al menos un día activo.'))
    fireEvent.change(screen.getByRole('textbox', { name: 'Prefijo de las divisiones' }), { target: { value: 'T' } })

    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByText('Elegí al menos un día activo.')).toBeTruthy()
    expect(screen.getByText('Sprint 21')).toBeTruthy()
  })

  it('ignores an older preview that answers late', async () => {
    let resolveFirst: (preview: TaskBoardPlanPreview) => void = () => {}
    readBoardPlanPreview.mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve }))
    renderDialog()
    await waitFor(() => expect(readBoardPlanPreview).toHaveBeenCalledTimes(1))
    readBoardPlanPreview.mockResolvedValueOnce({ ...PREVIEW, workday: { ...PREVIEW.workday, hoursPerWeek: '54 h por semana' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sábado' }))
    expect(await screen.findByText('54 h por semana')).toBeTruthy()
    resolveFirst(PREVIEW)
    await Promise.resolve()
    expect(screen.queryByText('45 h por semana')).toBeNull()
  })
})
