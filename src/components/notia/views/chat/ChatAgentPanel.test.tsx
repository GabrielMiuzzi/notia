// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { ChatAgentPanelSections } from './ChatAgentPanel'
import { DEFAULT_CHAT_SETTINGS, type ChatAgentCatalog } from '../../../../services/chat/chatAgentsRuntime'

const catalog: ChatAgentCatalog = {
  dynamics: [
    { fileName: 'debate.md', name: 'Debate', description: 'Los agentes se contrastan', initials: '', valid: true },
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

describe('ChatAgentPanelSections', () => {
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('starts with every tool, no dynamic and Notia answering alone', () => {
    render(<ChatAgentPanelSections catalog={catalog} settings={DEFAULT_CHAT_SETTINGS} looks={looks} isDisabled={false} onChange={vi.fn()} />)
    expect(screen.getByRole('switch', { name: /Uso de herramientas/ }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('switch', { name: /lectura\/escritura/ }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('button', { name: /Ninguna/ })).toBeTruthy()
    expect(screen.getByText('Sin agentes: responde solo Notia.')).toBeTruthy()
  })

  it('turns tools off and keeps writing tied to them', () => {
    const onChange = vi.fn()
    const { rerender } = render(
      <ChatAgentPanelSections catalog={catalog} settings={DEFAULT_CHAT_SETTINGS} looks={looks} isDisabled={false} onChange={onChange} />,
    )
    fireEvent.click(screen.getByRole('switch', { name: /Uso de herramientas/ }))
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_CHAT_SETTINGS, toolsEnabled: false })
    rerender(
      <ChatAgentPanelSections
        catalog={catalog}
        settings={{ ...DEFAULT_CHAT_SETTINGS, toolsEnabled: false }}
        looks={looks}
        isDisabled={false}
        onChange={onChange}
      />,
    )
    expect((screen.getByRole('switch', { name: /lectura\/escritura/ }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('picks a dynamic from the list, which leaves out unreadable files', () => {
    const onChange = vi.fn()
    render(<ChatAgentPanelSections catalog={catalog} settings={DEFAULT_CHAT_SETTINGS} looks={looks} isDisabled={false} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: /Ninguna/ }))
    expect((screen.getByRole('option', { name: /vacia/ }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('option', { name: /Debate/ }))
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_CHAT_SETTINGS, dynamic: 'debate.md' })
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('adds and removes agents', () => {
    const onChange = vi.fn()
    const settings = { ...DEFAULT_CHAT_SETTINGS, agents: ['investigador.md'] }
    render(<ChatAgentPanelSections catalog={catalog} settings={settings} looks={looks} isDisabled={false} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Agregar agente' }))
    const dialog = screen.getByRole('dialog', { name: 'Agregar agente' })
    expect(dialog.textContent).toContain('Agregado')
    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar agentes' }), { target: { value: 'pasos' } })
    expect(within(dialog).queryByRole('button', { name: /Investigador/ })).toBeNull()
    fireEvent.click(within(dialog).getByRole('button', { name: /Planificador/ }))
    expect(onChange).toHaveBeenLastCalledWith({ ...settings, agents: ['investigador.md', 'planificador.md'] })
    fireEvent.click(screen.getByRole('button', { name: 'Quitar Investigador' }))
    expect(onChange).toHaveBeenLastCalledWith({ ...settings, agents: [] })
  })

  it('saves the permanent context after a pause in typing', () => {
    vi.useFakeTimers()
    const onChange = vi.fn()
    render(<ChatAgentPanelSections catalog={catalog} settings={DEFAULT_CHAT_SETTINGS} looks={looks} isDisabled={false} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('Contexto permanente'), { target: { value: 'Respondé corto.' } })
    expect(onChange).not.toHaveBeenCalled()
    vi.advanceTimersByTime(800)
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_CHAT_SETTINGS, permanentContext: 'Respondé corto.' })
  })
})
