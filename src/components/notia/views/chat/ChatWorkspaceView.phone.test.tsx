// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Provider } from 'react-redux'
import { store } from '../../../../store'
import { ConfirmationEngineProvider } from '../../../../context/confirmation/ConfirmationEngine'
import { installBackendTransport } from '../../../../services/transport'
import { ChatWorkspaceView } from './ChatWorkspaceView'
import type { AiPreferences } from '../../../../services/preferences/aiSettingsStorage'

const CHAT = 'chat/chats/Chat-2026-10-02-10-00-00.md'
const answers: Record<string, unknown> = {
  ai_check_health: { ok: true, message: '' },
  ai_resolve_model: 'modelo-de-prueba',
  backend_agent_prompts: { prompts: [{ fileName: 'default.md', name: 'default' }], selected: 'default.md' },
  backend_agent_history: [],
  backend_pending_clarification: { status: 'none' },
  chat_agents_catalog: {
    dynamics: [{ fileName: 'mesa.md', name: 'Mesa redonda', description: 'Cada agente aporta su mirada', initials: '', valid: true }],
    agents: [{ fileName: 'investigador.md', name: 'Investigador', description: 'Busca y cita fuentes', initials: 'IN', valid: true }],
  },
  backend_list_chats: [{ id: CHAT, filePath: CHAT, title: 'Plan de la semana', group: 'today', pinned: false, agent: null, preview: '¿Qué queda para el viernes?' }],
}
const preferences: AiPreferences = { ollamaUrl: 'http://127.0.0.1:11434/api', apiKey: '', selectedModel: '', thinkingEnabled: true, thinkingLevel: 'medium' }
const library = { id: 'lib', name: 'gaia', path: 'C:/gaia' } as never

/** Width the chat view reports; the phone layout applies below 600 px. */
let viewWidth = 390

function renderView(showHistoryPanel: boolean) {
  return render(
    <Provider store={store}>
      <ConfirmationEngineProvider>
        <ChatWorkspaceView agentScope="library" library={library} aiPreferences={preferences} showHistoryPanel={showHistoryPanel} />
      </ConfirmationEngineProvider>
    </Provider>,
  )
}

describe('ChatWorkspaceView phone layout', () => {
  beforeEach(() => {
    installBackendTransport({
      kind: 'tauri',
      platform: () => 'windows',
      call: async (command: string) => answers[command] as never,
      subscribe: async () => () => undefined,
      fileUrl: (path: string) => path,
      supports: () => true,
    } as never)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const width = this.classList.contains('notia-chat-view') ? viewWidth : 0
      return { x: 0, y: 0, top: 0, left: 0, right: width, bottom: 0, width, height: 0, toJSON: () => ({}) } as DOMRect
    })
  })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    viewWidth = 390
  })

  it('follows the phone boards when the Chat IA view is narrow and opens its sheets', async () => {
    const { container } = renderView(true)
    await waitFor(() => expect(container.querySelector('.notia-chat-view--phone')).toBeTruthy())
    await waitFor(() => expect(screen.getByText('¿En qué trabajamos hoy?')).toBeTruthy())
    expect(screen.getByRole('heading', { name: 'Nuevo chat' })).toBeTruthy()
    expect(container.querySelector('.notia-chat-topbar')).toBeNull()

    await waitFor(() => expect((screen.getByRole('button', { name: 'Adjuntar archivo' }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: 'Adjuntar archivo' }))
    expect(screen.getByRole('dialog', { name: 'Adjuntar' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }))

    fireEvent.click(screen.getByRole('button', { name: 'Abrir contexto del chat' }))
    const context = screen.getByRole('dialog', { name: 'Contexto' })
    fireEvent.click(within(context).getByRole('button', { name: 'Agregar agente' }))
    const agents = await screen.findByRole('dialog', { name: 'Agregar agente' })
    fireEvent.click(within(agents).getByRole('button', { name: /Investigador/ }))
    // The agent list goes back to the context sheet it came from.
    fireEvent.click(within(agents).getByRole('button', { name: 'Listo · 1 agente' }))
    expect(screen.getByRole('dialog', { name: 'Contexto' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }))
    expect(screen.getByRole('button', { name: 'Sin dinámica · 1 agente. Elegir agentes' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Abrir contexto del chat (1 agente)' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Abrir historial de chats' }))
    const drawer = screen.getByRole('dialog', { name: 'Historial de chats' })
    await waitFor(() => expect(within(drawer).getByText('¿Qué queda para el viernes?')).toBeTruthy())
  })

  it('keeps the desktop layout when the view is wide and the side chat layout always', async () => {
    viewWidth = 900
    const wide = renderView(true)
    await waitFor(() => expect(wide.container.querySelector('.notia-chat-topbar')).toBeTruthy())
    expect(wide.container.querySelector('.notia-chat-view--phone')).toBeNull()
    cleanup()

    viewWidth = 390
    const side = renderView(false)
    await waitFor(() => expect(side.container.querySelector('.notia-chat-panel-header')).toBeTruthy())
    expect(side.container.querySelector('.notia-chat-view--phone')).toBeNull()
    expect(side.container.querySelector('.notia-chat-phone-header')).toBeNull()
  })
})
