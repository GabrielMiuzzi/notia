// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { AiActionsDashboard, ActionPreview } from '../types/aiActionsTypes'
import { AiActionsDashboardView } from './AiActionsDashboardView'

const callBackend = vi.fn()
vi.mock('../../../services/transport', () => ({
  callBackend: (...args: unknown[]) => callBackend(...args),
  subscribeBackend: () => Promise.resolve(() => undefined),
}))

const LIBRARY = { id: 'lib-1', name: 'gaia', path: 'C:/gaia' }

const DASHBOARD: AiActionsDashboard = {
  titleDate: 'Lunes 28 de septiembre',
  shortDate: 'lun 28 sep',
  nowTime: '13:42',
  filter: 'all',
  metrics: {
    doneToday: 2,
    failedToday: 1,
    pendingToday: 3,
    pendingUntil: 'Hasta las 21:00',
    recurringActive: 1,
    recurringTotal: 2,
    recurringPaused: 1,
    next: { actionId: 'correos', time: '14:30', inLabel: 'en 48 min', name: 'Resumen de correos', kindLabel: 'Horario' },
  },
  counts: { all: 3, reminder: 0, oneShot: 2, recurring: 1 },
  columns: [
    { kind: 'reminder', title: 'Recordatorios', subtitle: 'Te avisa con un mensaje', cards: [] },
    {
      kind: 'one-shot',
      title: 'Horarios',
      subtitle: 'Una vez, a hora exacta',
      cards: [
        { id: 'export', name: 'Exportar resumen', prompt: 'Generá el resumen', kind: 'one-shot', enabled: true, when: 'Hoy · 11:00', nextLabel: null, runsLabel: null, status: { tone: 'failed', label: 'Falló · 11:00' }, retryRunId: 'run-1' },
        { id: 'correos', name: 'Resumen de correos', prompt: 'Leé los correos', kind: 'one-shot', enabled: true, when: 'Hoy · 14:30', nextLabel: null, runsLabel: null, status: { tone: 'next', label: 'Próxima · 14:30' }, retryRunId: null },
      ],
    },
    {
      kind: 'recurring',
      title: 'Recurrentes',
      subtitle: 'Cada X tiempo',
      cards: [
        { id: 'gastos', name: 'Registrar gastos', prompt: 'Preguntame por gastos', kind: 'recurring', enabled: false, when: 'Cada 3 h · 09 a 21 h', nextLabel: '—', runsLabel: '2 de 5 hoy', status: { tone: 'paused', label: 'Pausada' }, retryRunId: null },
      ],
    },
  ],
  timeline: [
    { type: 'item', item: { time: '11:00', actionId: 'export', name: 'Exportar resumen', kind: 'one-shot', kindLabel: 'Horario', tone: 'failed', note: 'No se pudo enviar por Telegram.' } },
    { type: 'now', time: '13:42' },
    { type: 'item', item: { time: '14:30', actionId: 'correos', name: 'Resumen de correos', kind: 'one-shot', kindLabel: 'Horario', tone: 'next', note: 'en 48 min' } },
  ],
  progress: { done: 2, total: 6, percent: 33 },
}

const PREVIEW: ActionPreview = { errors: [], summary: 'La IA va a repetir este prompt en el intervalo elegido, de lunes a viernes, y te responde por Telegram.', when: 'Cada hora · Lun a Vie', upcoming: ['Hoy · 14:00', 'Hoy · 15:00', 'Hoy · 16:00'] }

function respond(command: string): unknown {
  if (command === 'ai_actions_dashboard') return DASHBOARD
  if (command === 'ai_action_preview') return PREVIEW
  return {}
}

async function renderView() {
  render(<AiActionsDashboardView library={LIBRARY} />)
  await screen.findByText('Exportar resumen', { selector: 'button' })
}

beforeEach(() => {
  callBackend.mockReset()
  callBackend.mockImplementation((command: string) => Promise.resolve(respond(command)))
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('AiActionsDashboardView', () => {
  it('shows the metrics, the columns and the day computed by Rust', async () => {
    await renderView()
    expect(screen.getByText('1 falló · se puede reintentar')).toBeTruthy()
    const next = screen.getByText('Próxima ejecución').parentElement as HTMLElement
    expect(within(next).getByText('14:30')).toBeTruthy()
    expect(within(next).getByText('Resumen de correos · Horario')).toBeTruthy()
    const today = screen.getByRole('complementary', { name: 'Hoy' })
    expect(within(today).getByText('AHORA')).toBeTruthy()
    expect(within(today).getByText('No se pudo enviar por Telegram.')).toBeTruthy()
    expect(within(today).getByText('2 de 6 ejecuciones')).toBeTruthy()
    expect(screen.getByRole('switch', { name: 'Activar: Registrar gastos' }).getAttribute('aria-checked')).toBe('false')
  })

  it('sends the filter, the search, the switch and the retry to Rust', async () => {
    await renderView()
    fireEvent.click(screen.getByRole('button', { name: /Recurrentes/ }))
    await vi.waitFor(() => expect(callBackend).toHaveBeenCalledWith('ai_actions_dashboard', expect.objectContaining({ filter: 'recurring' })))
    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar acciones o prompts' }), { target: { value: 'gastos' } })
    await vi.waitFor(() => expect(callBackend).toHaveBeenCalledWith('ai_actions_dashboard', expect.objectContaining({ query: 'gastos' })))
    fireEvent.click(screen.getByRole('switch', { name: 'Activar: Registrar gastos' }))
    await vi.waitFor(() => expect(callBackend).toHaveBeenCalledWith('ai_action_set_enabled', expect.objectContaining({ actionId: 'gastos', enabled: true })))
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    await vi.waitFor(() => expect(callBackend).toHaveBeenCalledWith('ai_action_retry', expect.objectContaining({ runId: 'run-1' })))
    const context = callBackend.mock.calls[0][1].context
    expect(context).toEqual({ libraryId: 'lib-1', libraryPath: 'C:/gaia', androidDirectoryUri: null, actorLibraryUserId: 'user-owner' })
  })

  it('creates an action with the form and shows what Rust previews', async () => {
    await renderView()
    fireEvent.click(screen.getByRole('button', { name: 'Nueva acción' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Nombre'), { target: { value: 'Revisión' } })
    fireEvent.change(within(dialog).getByLabelText(/^Prompt/), { target: { value: 'Revisá mis tareas' } })
    await within(dialog).findByText('Hoy · 15:00')
    expect(within(dialog).getByText(/de lunes a viernes, y te responde por Telegram/)).toBeTruthy()
    const save = within(dialog).getByRole('button', { name: 'Guardar acción' })
    await vi.waitFor(() => expect((save as HTMLButtonElement).disabled).toBe(false))
    await act(async () => { fireEvent.click(save) })
    await vi.waitFor(() => expect(callBackend).toHaveBeenCalledWith('ai_action_create', expect.objectContaining({
      input: expect.objectContaining({ kind: 'recurring', name: 'Revisión', prompt: 'Revisá mis tareas', weekdays: [0, 1, 2, 3, 4] }),
    })))
    expect(await screen.findByText('Acción creada.')).toBeTruthy()
  })

  it('keeps «Guardar» disabled and shows the field errors while Rust reports them', async () => {
    callBackend.mockImplementation((command: string) => Promise.resolve(command === 'ai_action_preview'
      ? { errors: [{ field: 'name', message: 'Poné un nombre.' }], summary: '', when: null, upcoming: [] }
      : respond(command)))
    await renderView()
    fireEvent.click(screen.getByRole('button', { name: 'Nueva acción' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Nombre'), { target: { value: ' ' } })
    expect(await within(dialog).findByText('Poné un nombre.')).toBeTruthy()
    expect((within(dialog).getByRole('button', { name: 'Guardar acción' }) as HTMLButtonElement).disabled).toBe(true)
    expect(within(dialog).getByText('Completá o corregí los campos para guardar.')).toBeTruthy()
  })
})
