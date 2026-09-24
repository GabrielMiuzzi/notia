import { describe, expect, it, vi } from 'vitest'

const { invokePublishedTaskManagerMutation } = vi.hoisted(() => ({ invokePublishedTaskManagerMutation: vi.fn() }))

vi.mock('./taskManagerPublicationClient', () => ({
  invokePublishedTaskManagerMutation,
  isTaskManagerPublicationMutationCommand: (command: string) => command === 'task_manager_board_execute',
}))

import { createTaskManagerPublicationTransport } from './taskManagerPublicationTransport'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

describe('taskManagerPublicationTransport', () => {
  it('reads through the publication and sends mutations through its socket client', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { result: { boards: [] } }))
    invokePublishedTaskManagerMutation.mockResolvedValue({ changed: true })
    const transport = createTaskManagerPublicationTransport('/task-manager', fetchImpl, vi.fn())
    await expect(transport.call('task_manager_board_view', { payload: {} })).resolves.toEqual({ boards: [] })
    expect(fetchImpl).toHaveBeenCalledWith('/task-manager/invoke', expect.objectContaining({
      body: JSON.stringify({ command: 'task_manager_board_view', args: { payload: {} } }),
    }))
    await expect(transport.call('task_manager_board_execute', { payload: {} })).resolves.toEqual({ changed: true })
    expect(invokePublishedTaskManagerMutation).toHaveBeenCalledWith('task_manager_board_execute', { payload: {} })
  })

  it('stops reading after the session expires', async () => {
    const onSessionExpired = vi.fn()
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(401, { error: 'Ingresá la contraseña para acceder.' }))
    const transport = createTaskManagerPublicationTransport('/task-manager', fetchImpl, onSessionExpired)
    await expect(transport.call('task_manager_board_view')).rejects.toThrow('venció')
    expect(onSessionExpired).toHaveBeenCalledOnce()
    await expect(transport.call('task_manager_board_view')).rejects.toThrow('venció')
    expect(fetchImpl).toHaveBeenCalledOnce()
  })
})
