// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import { ChatPhoneAgentsBar, ChatPhoneHeader, ChatPhoneWelcome } from './ChatPhone'
import { ChatPhoneAgentsSheet, ChatPhoneAttachSheet, ChatPhoneContextSheet, ChatPhoneDynamicSheet, type ChatPhoneContextSheetProps } from './ChatPhoneSheets'
import { ChatPhoneHistoryDrawer } from './ChatPhoneHistory'
import { useKeyboardInset } from './useKeyboardInset'
import { DEFAULT_CHAT_SETTINGS, type ChatAgentCatalog } from '../../../../services/chat/chatAgentsRuntime'
import type { ChatListItem } from '../../../../services/chat/chatDocumentStorage'

const storage = vi.hoisted(() => ({
  listChatHistory: vi.fn(),
  setChatPinned: vi.fn(),
  renameChat: vi.fn(),
}))
vi.mock('../../../../services/chat/chatDocumentStorage', () => storage)

const catalog: ChatAgentCatalog = {
  dynamics: [
    { fileName: 'mesa.md', name: 'Mesa redonda', description: 'Cada agente aporta su mirada', initials: '', valid: true },
    { fileName: 'vacia.md', name: 'vacia', description: '', initials: '', valid: false },
  ],
  agents: [
    { fileName: 'investigador.md', name: 'Investigador', description: 'Busca y cita fuentes', initials: 'IN', valid: true },
    { fileName: 'planificador.md', name: 'Planificador', description: 'Convierte pendientes en pasos', initials: 'PL', valid: true },
  ],
}
const looks = {
  'investigador.md': { name: 'Investigador', initials: 'IN', colorIndex: 0 },
  'planificador.md': { name: 'Planificador', initials: 'PL', colorIndex: 1 },
}
const library = { id: 'lib', name: 'gaia', path: 'C:/gaia' }

function renderContextSheet(overrides: Partial<ChatPhoneContextSheetProps> = {}) {
  const props: ChatPhoneContextSheetProps = {
    libraryName: 'gaia',
    libraryRagEnabled: true,
    contextFiles: [],
    contextFolders: [],
    contextMode: 'direct',
    starters: [{ title: 'Resumí estas notas', description: '', prompt: 'Resume estas notas' }],
    isDisabled: false,
    onChooseFiles: vi.fn(),
    onChooseFolders: vi.fn(),
    onRemoveFile: vi.fn(),
    onRemoveFolder: vi.fn(),
    onSelectStarter: vi.fn(),
    agentMemoryEnabled: true,
    isAgentMemoryChoiceLocked: false,
    onAgentMemoryChange: vi.fn(),
    onOpenMemory: vi.fn(),
    catalog,
    settings: DEFAULT_CHAT_SETTINGS,
    looks,
    areSettingsDisabled: false,
    onSettingsChange: vi.fn(),
    settingsError: null,
    onDismissSettingsError: vi.fn(),
    onOpenDynamic: vi.fn(),
    onOpenAgents: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  }
  render(<ChatPhoneContextSheet {...props} />)
  return props
}

describe('Chat IA phone header and conversation', () => {
  afterEach(cleanup)

  it('opens the history, the model settings, the context and a new chat; the context shows how many agents', () => {
    const handlers = { onOpenHistory: vi.fn(), onOpenModelSettings: vi.fn(), onOpenContext: vi.fn(), onNewChat: vi.fn() }
    render(<ChatPhoneHeader title="Tareas" modelLabel="deepseek-v4.1-flash" isAiAvailable agentCount={2} {...handlers} />)
    expect(screen.getByRole('heading', { name: 'Tareas' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Abrir historial de chats' }))
    fireEvent.click(screen.getByRole('button', { name: 'Modelo: deepseek-v4.1-flash. Abrir configuración de IA' }))
    fireEvent.click(screen.getByRole('button', { name: 'Abrir contexto del chat (2 agentes)' }))
    fireEvent.click(screen.getByRole('button', { name: 'Nuevo chat' }))
    expect(handlers.onOpenHistory).toHaveBeenCalledOnce()
    expect(handlers.onOpenModelSettings).toHaveBeenCalledOnce()
    expect(handlers.onOpenContext).toHaveBeenCalledOnce()
    expect(handlers.onNewChat).toHaveBeenCalledOnce()
  })

  it('summarizes the dynamic and agents and opens the agent list', () => {
    const onOpen = vi.fn()
    render(<ChatPhoneAgentsBar dynamicName="Mesa redonda" agents={Object.values(looks)} onOpen={onOpen} />)
    const bar = screen.getByRole('button', { name: 'Mesa redonda · 2 agentes. Elegir agentes' })
    expect(bar.textContent).toContain('INPL')
    fireEvent.click(bar)
    expect(onOpen).toHaveBeenCalledOnce()
  })

  it('greets with the library and puts a starter in the composer', () => {
    const onSelectStarter = vi.fn()
    render(
      <ChatPhoneWelcome
        libraryName="gaia"
        starters={[{ title: 'Próximos pasos concretos', description: 'Convertí pendientes en acciones claras.', prompt: 'Dame proximos pasos concretos' }]}
        onSelectStarter={onSelectStarter}
      />,
    )
    expect(screen.getByText('Preguntá sobre la librería gaia y tus tareas.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Próximos pasos concretos/ }))
    expect(onSelectStarter).toHaveBeenCalledWith('Dame proximos pasos concretos')
  })
})

describe('Chat IA phone context sheet', () => {
  afterEach(cleanup)

  it('keeps memory, tools, writing and the permanent context of the chat', () => {
    vi.useFakeTimers()
    const props = renderContextSheet()
    expect(screen.getByRole('dialog', { name: 'Contexto' })).toBeTruthy()
    expect(screen.getByText('Búsqueda en la librería gaia')).toBeTruthy()
    fireEvent.click(screen.getByRole('switch', { name: /Memoria persistente del agente/ }))
    expect(props.onAgentMemoryChange).toHaveBeenCalledWith(false)
    fireEvent.click(screen.getByRole('switch', { name: /Uso de herramientas/ }))
    expect(props.onSettingsChange).toHaveBeenCalledWith({ ...DEFAULT_CHAT_SETTINGS, toolsEnabled: false })
    fireEvent.click(screen.getByRole('switch', { name: /lectura\/escritura/ }))
    expect(props.onSettingsChange).toHaveBeenCalledWith({ ...DEFAULT_CHAT_SETTINGS, writeEnabled: false })
    fireEvent.change(screen.getByLabelText('Contexto permanente'), { target: { value: 'Respondé corto.' } })
    vi.advanceTimersByTime(800)
    expect(props.onSettingsChange).toHaveBeenCalledWith({ ...DEFAULT_CHAT_SETTINGS, permanentContext: 'Respondé corto.' })
    vi.useRealTimers()
  })

  it('locks the memory of an existing chat and opens files, folders, starters, dynamic and agents', () => {
    const props = renderContextSheet({ isAgentMemoryChoiceLocked: true })
    expect((screen.getByRole('switch', { name: /Memoria persistente del agente/ }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('Este chat usa memory.md. Se elige al crear el chat.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Elegir archivos de la librería/ }))
    fireEvent.click(screen.getByRole('button', { name: /Elegir carpetas de la librería/ }))
    fireEvent.click(screen.getByRole('button', { name: /Resumí estas notas/ }))
    fireEvent.click(screen.getByRole('button', { name: /Ninguna/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Agregar agente' }))
    fireEvent.click(screen.getByRole('button', { name: 'Administrar memoria' }))
    expect(props.onChooseFiles).toHaveBeenCalledOnce()
    expect(props.onChooseFolders).toHaveBeenCalledOnce()
    expect(props.onSelectStarter).toHaveBeenCalledWith('Resume estas notas')
    expect(props.onOpenDynamic).toHaveBeenCalledOnce()
    expect(props.onOpenAgents).toHaveBeenCalledOnce()
    expect(props.onOpenMemory).toHaveBeenCalledOnce()
  })

  it('lists the agents of the chat and removes one', () => {
    const settings = { ...DEFAULT_CHAT_SETTINGS, dynamic: 'mesa.md', agents: ['investigador.md', 'planificador.md'] }
    const props = renderContextSheet({ settings })
    expect(screen.getByRole('button', { name: /Mesa redonda Cada agente aporta su mirada/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Quitar Investigador' }))
    expect(props.onSettingsChange).toHaveBeenCalledWith({ ...settings, agents: ['planificador.md'] })
  })

  it('closes with its button and with Escape', () => {
    const props = renderContextSheet()
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }))
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Contexto' }), { key: 'Escape' })
    expect(props.onClose).toHaveBeenCalledTimes(2)
  })
})

describe('Chat IA phone sheets', () => {
  afterEach(cleanup)

  it('adds and removes agents and says how many are in the chat', () => {
    const onChange = vi.fn()
    const onClose = vi.fn()
    render(
      <ChatPhoneAgentsSheet
        agents={catalog.agents}
        selected={['investigador.md']}
        looks={looks}
        isDisabled={false}
        onChange={onChange}
        settingsError={null}
        onDismissSettingsError={vi.fn()}
        onClose={onClose}
      />,
    )
    const dialog = screen.getByRole('dialog', { name: 'Agregar agente' })
    expect(within(dialog).getByRole('button', { name: /Investigador/ }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(within(dialog).getByRole('button', { name: /Planificador/ }))
    expect(onChange).toHaveBeenLastCalledWith(['investigador.md', 'planificador.md'])
    fireEvent.click(within(dialog).getByRole('button', { name: /Investigador/ }))
    expect(onChange).toHaveBeenLastCalledWith([])
    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar agentes' }), { target: { value: 'pasos' } })
    expect(within(dialog).queryByRole('button', { name: /Investigador/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Listo · 1 agente' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('picks a dynamic, leaving out unreadable files', () => {
    const onSelect = vi.fn()
    render(
      <ChatPhoneDynamicSheet
        dynamics={catalog.dynamics}
        selected={null}
        isDisabled={false}
        onSelect={onSelect}
        settingsError={null}
        onDismissSettingsError={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect((screen.getByRole('radio', { name: /Ninguna/ }) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByRole('radio', { name: /vacia/ }) as HTMLInputElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('radio', { name: /Mesa redonda/ }))
    expect(onSelect).toHaveBeenCalledWith('mesa.md')
  })

  it('attaches a device file, library files or folders and switches the library search', () => {
    const handlers = { onSelectFile: vi.fn(), onOpenLibraryFiles: vi.fn(), onOpenLibraryFolders: vi.fn(), onLibraryRagChange: vi.fn(), onClose: vi.fn() }
    render(<ChatPhoneAttachSheet libraryName="gaia" libraryRagEnabled isRagDisabled={false} {...handlers} />)
    fireEvent.click(screen.getByRole('button', { name: /Seleccionar archivo/ }))
    fireEvent.click(screen.getByRole('button', { name: /Buscar archivos de la librería/ }))
    fireEvent.click(screen.getByRole('button', { name: /Buscar carpetas de la librería/ }))
    fireEvent.click(screen.getByRole('switch', { name: /Toda la librería/ }))
    expect(handlers.onSelectFile).toHaveBeenCalledOnce()
    expect(handlers.onOpenLibraryFiles).toHaveBeenCalledOnce()
    expect(handlers.onOpenLibraryFolders).toHaveBeenCalledOnce()
    expect(handlers.onLibraryRagChange).toHaveBeenCalledWith(false)
    expect(screen.getByText('La IA busca en toda gaia')).toBeTruthy()
  })
})

describe('Chat IA phone history drawer', () => {
  const chats: ChatListItem[] = [
    { id: 'a', title: 'Tareas de Lucía', filePath: 'chat/chats/a.md', group: 'today', pinned: false, agent: null, preview: '¿Con qué tareas está Lucía?' },
    { id: 'b', title: 'Plan fijado', filePath: 'chat/chats/b.md', group: 'pinned', pinned: true, agent: null },
    { id: 'c', title: 'Borrado', filePath: 'chat/chats/c.md', group: 'today', pinned: false, agent: null },
  ]
  beforeEach(() => {
    storage.listChatHistory.mockReset().mockResolvedValue(chats)
  })
  afterEach(cleanup)

  it('groups the chats with their preview, hides deleted ones and opens a chat', async () => {
    const props = {
      library,
      selectedChatFilePath: 'chat/chats/a.md',
      hiddenChatPaths: ['chat/chats/c.md'],
      onPickChat: vi.fn(),
      onNewChat: vi.fn(),
      onOpenChatOptions: vi.fn(),
      onClose: vi.fn(),
    }
    render(<ChatPhoneHistoryDrawer {...props} />)
    const drawer = screen.getByRole('dialog', { name: 'Historial de chats' })
    await waitFor(() => expect(within(drawer).getByText('Tareas de Lucía')).toBeTruthy())
    expect(within(drawer).getAllByRole('group').map((group) => group.getAttribute('aria-label'))).toEqual(['Fijados', 'Hoy'])
    expect(within(drawer).getByText('¿Con qué tareas está Lucía?')).toBeTruthy()
    expect(within(drawer).queryByText('Borrado')).toBeNull()
    expect(within(drawer).getByRole('button', { name: /^Tareas de Lucía/ }).getAttribute('aria-current')).toBe('true')
    fireEvent.click(within(drawer).getByRole('button', { name: 'Opciones de Plan fijado' }))
    expect(props.onOpenChatOptions).toHaveBeenCalledWith(chats[1], expect.anything())
    fireEvent.change(within(drawer).getByRole('searchbox', { name: 'Buscar chats' }), { target: { value: 'zzz' } })
    expect(within(drawer).getByText('Ningún chat coincide con la búsqueda.')).toBeTruthy()
    fireEvent.change(within(drawer).getByRole('searchbox', { name: 'Buscar chats' }), { target: { value: 'plan' } })
    fireEvent.click(within(drawer).getByRole('button', { name: 'Plan fijado' }))
    expect(props.onPickChat).toHaveBeenCalledWith(chats[1])
    fireEvent.click(within(drawer).getByRole('button', { name: /Nuevo chat/ }))
    expect(props.onNewChat).toHaveBeenCalledOnce()
    fireEvent.click(within(drawer).getByRole('button', { name: 'Cerrar historial' }))
    expect(props.onClose).toHaveBeenCalledOnce()
  })
})

describe('useKeyboardInset', () => {
  const viewport = new EventTarget() as EventTarget & { height: number; offsetTop: number }
  beforeEach(() => {
    viewport.height = 800
    viewport.offsetTop = 0
    vi.stubGlobal('visualViewport', viewport)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    cleanup()
  })

  it('lifts the layout by what the keyboard covers only while a field is focused', () => {
    const element = document.createElement('div')
    element.getBoundingClientRect = () => ({ bottom: 800 }) as DOMRect
    const field = document.createElement('textarea')
    document.body.append(element, field)
    const { result } = renderHook(() => useKeyboardInset(element))
    expect(result.current).toBe(0)
    act(() => {
      field.focus()
      viewport.height = 500
      viewport.dispatchEvent(new Event('resize'))
    })
    expect(result.current).toBe(300)
    act(() => {
      field.blur()
      viewport.dispatchEvent(new Event('resize'))
    })
    expect(result.current).toBe(0)
    element.remove()
    field.remove()
  })
})
