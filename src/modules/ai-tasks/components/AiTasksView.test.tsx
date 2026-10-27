// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { AiTaskCard, AiTaskDetail } from '../types/aiTasksTypes'
import { AiTasksView } from './AiTasksView'

const callBackend = vi.fn()
vi.mock('../../../services/transport', () => ({
  callBackend: (...args: unknown[]) => callBackend(...args),
  subscribeBackend: () => Promise.resolve(() => undefined),
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
    { id: 's1', number: 1, roundLabel: 'Plan inicial', title: 'Leer el índice', detail: '', status: 'done', statusLabel: 'Hecho', report: 'Leí **38** documentos.', timeLabel: 'Hoy · 21:45' },
    { id: 's2', number: 2, roundLabel: 'Plan inicial', title: 'Reordenar', detail: 'Mover la etapa 4', status: 'running', statusLabel: 'En curso', report: null, timeLabel: null },
    { id: 's3', number: 3, roundLabel: 'Plan inicial', title: 'Encadenar', detail: '', status: 'pending', statusLabel: 'Pendiente', report: null, timeLabel: null },
  ],
  reviews: [],
  pending: { id: 'ab12cd34', kind: 'confirmation', heading: 'El Ejecutor necesita tu confirmación (paso 2)', title: 'Editar Indice.md', detail: 'nextPage: x', options: [] },
  result: null,
  error: null,
  workflow: 'flowchart TD\n  start(["Pedido"])',
  canCancel: true,
  canResume: false,
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
})
