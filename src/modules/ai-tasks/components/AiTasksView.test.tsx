// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { AiTaskCard, AiTaskDetail } from '../types/aiTasksTypes'
import { AiTasksView } from './AiTasksView'

const callBackend = vi.fn()
const listeners = new Map<string, (value: unknown) => void>()
vi.mock('../../../services/transport', () => ({
  callBackend: (...args: unknown[]) => callBackend(...args),
  subscribeBackend: (event: string, listener: (value: unknown) => void) => {
    listeners.set(event, listener)
    return Promise.resolve(() => { listeners.delete(event) })
  },
}))
// The graph needs the store and Mermaid; its source is what matters here.
vi.mock('./AiTaskWorkflowGraph', () => ({
  AiTaskWorkflowGraph: ({ code }: { code: string }) => <pre data-testid="workflow">{code}</pre>,
}))

const LIBRARY = { id: 'lib-1', name: 'gaia', path: 'C:/gaia' }
const CONTEXT = { libraryId: 'lib-1', actorLibraryUserId: 'user-owner' }

const CARD: AiTaskCard = {
  id: 't1',
  title: 'Ordenar la wiki',
  status: 'awaiting-approval',
  statusLabel: 'Esperando aprobación',
  phaseLabel: 'Espera tu confirmación',
  doneSteps: 1,
  totalSteps: 3,
  origin: 'telegram',
  originLabel: 'Telegram',
  approveAll: false,
  needsYou: true,
  createdLabel: 'Hoy · 21:40',
  updatedLabel: 'Hoy · 21:50',
}

const DETAIL: AiTaskDetail = {
  ...CARD,
  goal: 'Reordenar el índice del curso.',
  steps: [
    { id: 's1', number: 1, roundLabel: 'Plan inicial', title: 'Leer el índice', detail: '', status: 'done', statusLabel: 'Hecho', report: 'Leí **38** documentos.', notes: [], timeLabel: 'Hoy · 21:45' },
    { id: 's2', number: 2, roundLabel: 'Plan inicial', title: 'Reordenar', detail: 'Mover la etapa 4', status: 'running', statusLabel: 'En curso', report: null, notes: [], timeLabel: null },
    { id: 's3', number: 3, roundLabel: 'Plan inicial', title: 'Encadenar', detail: '', status: 'pending', statusLabel: 'Pendiente', report: null, notes: [], timeLabel: null },
  ],
  reviews: [],
  pending: { id: 'ab12cd34', kind: 'confirmation', heading: 'El Ejecutor necesita tu confirmación (paso 2)', title: 'Editar Indice.md', detail: 'nextPage: x', options: [] },
  wait: null,
  result: null,
  error: null,
  workflow: 'flowchart TD\n  start(["Pedido"])',
  canCancel: true,
  canResume: false,
  resumeLabel: 'Reanudar',
  expiresLabel: 'Se borra dom 1 nov · 21:40',
}

function respond() {
  callBackend.mockImplementation((command: string) => {
    if (command === 'ai_tasks_list') return Promise.resolve([CARD])
    if (command === 'ai_task_get') return Promise.resolve(DETAIL)
    return Promise.resolve(undefined)
  })
}

describe('AiTasksView', () => {
  beforeEach(() => {
    callBackend.mockReset()
    listeners.clear()
    respond()
  })
  afterEach(cleanup)

  it('lists the tasks and explains an empty panel', async () => {
    callBackend.mockImplementation((command: string) => Promise.resolve(command === 'ai_tasks_list' ? [] : undefined))
    render(<AiTasksView library={LIBRARY} />)
    expect(await screen.findByText('Todavía no hay tareas.')).toBeTruthy()
    expect(callBackend).toHaveBeenCalledWith('ai_tasks_list', { context: CONTEXT })
  })

  it('shows the step by step, the workflow and answers an approval through Rust', async () => {
    render(<AiTasksView library={LIBRARY} />)
    fireEvent.click(await screen.findByRole('button', { name: /Ordenar la wiki/ }))
    expect(await screen.findByText('El Ejecutor necesita tu confirmación (paso 2)')).toBeTruthy()
    expect(callBackend).toHaveBeenCalledWith('ai_task_get', { context: CONTEXT, taskId: 't1' })
    expect(screen.getByTestId('workflow').textContent).toContain('flowchart TD')
    expect(screen.getByText('Mover la etapa 4')).toBeTruthy()
    expect(screen.getByText('Se borra dom 1 nov · 21:40')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Confirmar todos' }))
    await waitFor(() => expect(callBackend).toHaveBeenCalledWith('ai_task_answer', {
      context: CONTEXT,
      taskId: 't1',
      approvalId: 'ab12cd34',
      answer: { choice: 'confirm-all' },
    }))
  })

  it('asks what to do instead before sending a proposal, and cancels the task', async () => {
    render(<AiTasksView library={LIBRARY} />)
    fireEvent.click(await screen.findByRole('button', { name: /Ordenar la wiki/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Proponer otra cosa' }))
    const send = screen.getByRole('button', { name: 'Enviar propuesta' }) as HTMLButtonElement
    expect(send.disabled).toBe(true)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Solo la etapa 4' } })
    fireEvent.click(send)
    await waitFor(() => expect(callBackend).toHaveBeenCalledWith('ai_task_answer', expect.objectContaining({ answer: { choice: 'propose', text: 'Solo la etapa 4' } })))

    fireEvent.click(screen.getByRole('button', { name: /^Cancelar$/ }))
    await waitFor(() => expect(callBackend).toHaveBeenCalledWith('ai_task_cancel', { context: CONTEXT, taskId: 't1' }))
  })

  it('says what a waiting task waits for and goes on without waiting', async () => {
    const waiting: AiTaskDetail = {
      ...DETAIL,
      status: 'waiting',
      statusLabel: 'Esperando',
      pending: null,
      needsYou: false,
      canResume: true,
      resumeLabel: 'Seguir sin esperar',
      expiresLabel: 'No se borra mientras espera',
      steps: DETAIL.steps.map((step) => step.id === 's2'
        ? { ...step, status: 'waiting', statusLabel: 'Esperando', notes: ['Mandé el pedido de acceso a soporte.'] }
        : step),
      wait: {
        reason: 'Respuesta de soporte sobre el acceso',
        kindLabel: 'Respuesta por correo en el hilo (yo@gmail.com)',
        sinceLabel: 'Desde hoy · 10:00',
        nextLabel: 'Próxima revisión del correo: hoy · 10:05',
        deadlineLabel: 'Espera hasta jue 30 oct · 10:00',
        error: null,
      },
    }
    callBackend.mockImplementation((command: string) => {
      if (command === 'ai_tasks_list') return Promise.resolve([waiting])
      if (command === 'ai_task_get') return Promise.resolve(waiting)
      return Promise.resolve(undefined)
    })
    render(<AiTasksView library={LIBRARY} />)
    fireEvent.click(await screen.findByRole('button', { name: /Ordenar la wiki/ }))
    expect(await screen.findByText('Respuesta de soporte sobre el acceso')).toBeTruthy()
    expect(screen.getByText('Próxima revisión del correo: hoy · 10:05')).toBeTruthy()
    expect(screen.getByText('Mandé el pedido de acceso a soporte.')).toBeTruthy()
    expect(callBackend).not.toHaveBeenCalledWith('ai_task_thinking', expect.anything())

    fireEvent.click(screen.getByRole('button', { name: /Seguir sin esperar/ }))
    await waitFor(() => expect(callBackend).toHaveBeenCalledWith('ai_task_resume', { context: CONTEXT, taskId: 't1' }))
  })

  it('streams the thinking of the step that runs', async () => {
    const running: AiTaskDetail = { ...DETAIL, status: 'running', statusLabel: 'Ejecutando', pending: null, needsYou: false }
    callBackend.mockImplementation((command: string) => {
      if (command === 'ai_tasks_list') return Promise.resolve([running])
      if (command === 'ai_task_get') return Promise.resolve(running)
      if (command === 'ai_task_thinking') {
        return Promise.resolve({ requestId: 'ai-task-1', phase: 'executor', stepId: 's2', label: 'Ejecutor · paso 2 · pensando', text: 'Leo el índice.', sequence: 3, maxChars: 20000 })
      }
      return Promise.resolve(undefined)
    })
    render(<AiTasksView library={LIBRARY} />)
    fireEvent.click(await screen.findByRole('button', { name: /Ordenar la wiki/ }))
    expect(await screen.findByText('Ejecutor · paso 2 · pensando')).toBeTruthy()
    expect(callBackend).toHaveBeenCalledWith('ai_task_thinking', { context: CONTEXT, taskId: 't1' })
    await waitFor(() => expect(listeners.has('notia:backend-event')).toBe(true))
    const send = (requestId: string, sequence: number, summary: string) => act(() => {
      listeners.get('notia:backend-event')?.({ requestId, sequence, event: { type: 'thinking-summary', requestId, summary } })
    })
    send('ai-task-1', 4, ' Ahora muevo la etapa.')
    send('ai-task-1', 2, ' viejo')
    send('otra-corrida', 9, ' ajeno')
    await waitFor(() => expect(screen.getByText('Leo el índice. Ahora muevo la etapa.')).toBeTruthy())
  })
})
