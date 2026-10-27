// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { PublishedTopBar } from './PublishedTopBar'

function renderBar(overrides: Partial<Parameters<typeof PublishedTopBar>[0]> = {}) {
  const props = {
    explorerOpen: true,
    onToggleExplorer: vi.fn(),
    vaultName: 'published-vault',
    location: { kind: 'tasks' as const },
    tabs: null,
    connection: 'connected' as const,
    lastSyncAt: Date.now() - 5 * 60_000,
    onSync: vi.fn(),
    onCopyLink: vi.fn(),
    chatOpen: false,
    onToggleChat: vi.fn(),
    theme: 'dark' as const,
    onToggleTheme: vi.fn(),
    userName: 'Gabriel Díaz',
    userRole: 'Propietario',
    onLogout: vi.fn(),
    ...overrides,
  }
  render(<PublishedTopBar {...props} />)
  return props
}

describe('PublishedTopBar', () => {
  afterEach(cleanup)

  it('shows the path, the sync state and toggles the explorer and the assistant', () => {
    const props = renderBar()
    expect(screen.getByText('Task Manager')).toBeTruthy()
    expect(screen.getByText('Sincronizado')).toBeTruthy()
    expect(screen.getByText('· hace 5 min')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Ocultar explorador' }))
    expect(props.onToggleExplorer).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Abrir asistente' }))
    expect(props.onToggleChat).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /Sincronizar ahora/ }))
    expect(props.onSync).toHaveBeenCalled()
  })

  it('signs out from the account menu', () => {
    const props = renderBar()
    fireEvent.click(screen.getByRole('button', { name: 'Cuenta de Gabriel Díaz' }))
    expect(screen.getByText('Propietario de published-vault')).toBeTruthy()
    expect(screen.getByText('GD')).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Cerrar sesión' }))
    expect(props.onLogout).toHaveBeenCalled()
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('cannot sync a publication that ended', () => {
    renderBar({ connection: 'revoked' })
    expect((screen.getByRole('button', { name: /Acceso revocado/ }) as HTMLButtonElement).disabled).toBe(true)
  })
})
