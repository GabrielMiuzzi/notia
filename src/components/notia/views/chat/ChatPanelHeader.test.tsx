// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ChatPanelHeader, type ChatPanelAgent } from './ChatPanelHeader'
import { ChatPanelWelcome } from './ChatPanelWelcome'
import { buildRightPanelChatContextChip } from '../../hooks/useRightPanelChatContext'
import type { OpenFileDocument } from '../../../../types/views/fileDocument'
import type { ChatListItem } from '../../../../services/chat/chatDocumentStorage'

const agents: ChatPanelAgent[] = [
  { fileName: 'default.md', name: 'General', description: 'Preguntas sobre toda la biblioteca.', initials: 'GE', colorIndex: 0 },
  { fileName: 'tasks.md', name: 'Task Manager', description: 'Lee y actualiza tickets del kanban.', initials: 'TM', colorIndex: 1 },
]

const storage = vi.hoisted(() => ({
  listChatHistory: vi.fn(),
  setChatPinned: vi.fn(),
  renameChat: vi.fn(),
}))
vi.mock('../../../../services/chat/chatDocumentStorage', () => storage)

const chats: ChatListItem[] = [
  { id: 'a', title: 'Pendientes con PE', filePath: 'chat/chats/a.md', group: 'today', pinned: false, agent: 'tasks.md' },
  { id: 'b', title: 'Resumen de la semana', filePath: 'chat/chats/b.md', group: 'thisWeek', pinned: false, agent: null },
  { id: 'c', title: 'Plan fijado', filePath: 'chat/chats/c.md', group: 'pinned', pinned: true, agent: null },
]

const lookOf = (agent: string | null) => agents.find((candidate) => candidate.fileName === (agent ?? 'default.md')) ?? agents[0]!

function renderHeader(overrides: Partial<Parameters<typeof ChatPanelHeader>[0]> = {}) {
  const props = {
    agents,
    selectedAgentFileName: 'tasks.md',
    isAgentChangeDisabled: false,
    onSelectAgent: vi.fn(),
    chatTitle: 'Pendientes con PE',
    library: { id: 'lib', name: 'gaia', path: 'C:/lib' },
    selectedChatFilePath: 'chat/chats/a.md',
    agentLookOf: lookOf,
    onPickChat: vi.fn(),
    onNewChat: vi.fn(),
    onDeleteChat: vi.fn(async () => {}),
    onClose: vi.fn(),
    ...overrides,
  }
  render(<ChatPanelHeader {...(props as Parameters<typeof ChatPanelHeader>[0])} />)
  return props
}

describe('ChatPanelHeader', () => {
  beforeEach(() => {
    storage.listChatHistory.mockReset().mockResolvedValue(chats)
    storage.setChatPinned.mockReset().mockResolvedValue(undefined)
    storage.renameChat.mockReset().mockResolvedValue({})
  })
  afterEach(cleanup)

  it('shows the agent that answers and the chat title', () => {
    renderHeader()
    expect(screen.getByRole('button', { name: /Agente: Task Manager/ })).toBeTruthy()
    expect(screen.getByText('· Pendientes con PE')).toBeTruthy()
  })

  it('chooses another agent from its list', () => {
    const props = renderHeader()
    fireEvent.click(screen.getByRole('button', { name: /Agente: Task Manager/ }))
    const list = screen.getByRole('listbox', { name: 'Agentes' })
    expect(list.textContent).toContain('Lee y actualiza tickets del kanban.')
    expect(screen.getByRole('option', { name: /Task Manager/ }).getAttribute('aria-selected')).toBe('true')
    fireEvent.click(screen.getByRole('option', { name: /General/ }))
    expect(props.onSelectAgent).toHaveBeenCalledWith('default.md')
    expect(screen.queryByRole('listbox', { name: 'Agentes' })).toBeNull()
  })

  it('groups the history, marks the open chat and opens another', async () => {
    const props = renderHeader()
    fireEvent.click(screen.getByRole('button', { name: 'Historial de chats' }))
    const dialog = screen.getByRole('dialog', { name: 'Historial de chats' })
    await waitFor(() => expect(within(dialog).getByText('Pendientes con PE')).toBeTruthy())
    expect(within(dialog).getAllByRole('group').map((group) => group.getAttribute('aria-label'))).toEqual(['Fijados', 'Hoy', 'Esta semana'])
    expect(within(within(dialog).getByRole('group', { name: 'Hoy' })).getByText('Actual')).toBeTruthy()
    expect(within(within(dialog).getByRole('group', { name: 'Hoy' })).getByText('Task Manager')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Resumen de la semana General' }))
    expect(props.onPickChat).toHaveBeenCalledWith(chats[1])
    expect(screen.queryByRole('dialog', { name: 'Historial de chats' })).toBeNull()
  })

  it('searches, pins, renames and deletes chats from the history', async () => {
    const props = renderHeader()
    fireEvent.click(screen.getByRole('button', { name: 'Historial de chats' }))
    await waitFor(() => expect(screen.getByText('Plan fijado')).toBeTruthy())
    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar conversaciones' }), { target: { value: 'zzz' } })
    expect(screen.getByText('Sin conversaciones que coincidan')).toBeTruthy()
    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar conversaciones' }), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Fijar «Resumen de la semana»' }))
    await waitFor(() => expect(storage.setChatPinned).toHaveBeenCalledWith('lib', 'chat/chats/b.md', true))
    fireEvent.click(screen.getByRole('button', { name: 'Renombrar «Resumen de la semana»' }))
    const field = screen.getByRole('textbox', { name: 'Nuevo nombre de «Resumen de la semana»' })
    fireEvent.change(field, { target: { value: 'Semana 39' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    await waitFor(() => expect(storage.renameChat).toHaveBeenCalledWith('lib', 'chat/chats/b.md', 'Semana 39'))
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar «Plan fijado»' }))
    expect(props.onDeleteChat).toHaveBeenCalledWith(chats[2])
  })

  it('starts a new chat from the history or the header and closes', () => {
    const props = renderHeader()
    fireEvent.click(screen.getByRole('button', { name: 'Historial de chats' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Historial de chats' })).getByRole('button', { name: /Nuevo chat/ }))
    expect(props.onNewChat).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Nuevo chat' }))
    expect(props.onNewChat).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar asistente' }))
    expect(props.onClose).toHaveBeenCalled()
  })

  it('shows «Asistente» when the view has no agent to choose', () => {
    renderHeader({ agents: [], chatTitle: null })
    expect(screen.getByText('Asistente')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Agente:/ })).toBeNull()
  })
})

describe('ChatPanelWelcome', () => {
  afterEach(cleanup)

  it('names the agent and sends a starter', () => {
    const onSendStarter = vi.fn()
    render(
      <ChatPanelWelcome
        agent={agents[1] ?? null}
        starters={[{ title: 'Resumí la nota', description: '', prompt: 'Resumí la nota abierta' }]}
        isDisabled={false}
        onSendStarter={onSendStarter}
      />,
    )
    expect(screen.getByText(/lee y actualiza tickets del kanban/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Resumí la nota/ }))
    expect(onSendStarter).toHaveBeenCalledWith('Resumí la nota abierta')
  })
})

describe('buildRightPanelChatContextChip', () => {
  const note = { name: 'anotaciones.md', path: 'C:/lib/anotaciones.md', viewKind: 'markdown' } as OpenFileDocument

  it('names the open note, its selection or the view', () => {
    expect(buildRightPanelChatContextChip('documents', note, '', null)).toEqual({ label: 'anotaciones.md', kind: 'document' })
    const selection = { blocks: [{}, {}] } as unknown as Parameters<typeof buildRightPanelChatContextChip>[3]
    expect(buildRightPanelChatContextChip('documents', note, '', selection).label).toBe('anotaciones.md · 2 bloques')
    expect(buildRightPanelChatContextChip('task-manager', null, '__pomodoro__', null)).toEqual({ label: 'Task Manager · Pomodoro', kind: 'view' })
    expect(buildRightPanelChatContextChip('documents', null, '', null)).toEqual({ label: 'Sin nota en contexto', kind: 'none' })
  })
})
