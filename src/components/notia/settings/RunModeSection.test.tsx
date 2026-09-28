// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ConnectionView } from '../../../services/connection/connectionRuntime'

const runtime = vi.hoisted(() => ({
  fetchConnection: vi.fn(),
  saveConnection: vi.fn(),
  testHostConnection: vi.fn(),
  pickCopyFolder: vi.fn(),
}))

vi.mock('../../../services/connection/connectionRuntime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../services/connection/connectionRuntime')>()),
  ...runtime,
}))

const { RunModeSection } = await import('./RunModeSection')

const view = (overrides: Partial<ConnectionView> = {}): ConnectionView => ({
  mode: 'host',
  clientKind: 'copy',
  hostAddress: '',
  canHost: true,
  server: { listening: true, port: 52480, error: null },
  link: { state: 'unknown', library: null, platform: null, signedIn: false, message: null },
  hostOnlyCommands: [],
  canKeepCopy: true,
  copyNeedsFolder: false,
  copyFolder: null,
  offlineCopy: false,
  copy: null,
  collaboration: true,
  deviceName: 'NOTEBOOK',
  ...overrides,
})

describe('RunModeSection', () => {
  beforeEach(() => {
    Object.values(runtime).forEach((mock) => mock.mockReset())
  })
  afterEach(cleanup)

  it('shows the port a host listens on', async () => {
    runtime.fetchConnection.mockResolvedValue(view())
    render(<RunModeSection />)
    expect(await screen.findByText('Escuchando')).toBeTruthy()
    expect(screen.getByText('52480')).toBeTruthy()
    expect(screen.getByRole('radio', { name: /Host/ }).getAttribute('aria-checked')).toBe('true')
  })

  it('becomes a client once the address of the host is saved', async () => {
    runtime.fetchConnection.mockResolvedValue(view())
    runtime.saveConnection.mockResolvedValue({ connection: view({ mode: 'client', hostAddress: '192.168.0.10:52480' }), reload: false })
    runtime.testHostConnection.mockResolvedValue({ ok: true, library: 'gaia', latencyMs: 4, message: null })
    render(<RunModeSection />)
    fireEvent.click(await screen.findByRole('radio', { name: /Cliente/ }))
    expect(runtime.saveConnection).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('radio', { name: /Remoto/ }))
    fireEvent.change(screen.getByLabelText('Dirección del host'), { target: { value: '192.168.0.10' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(runtime.saveConnection).toHaveBeenCalledWith({
      mode: 'client',
      clientKind: 'remote',
      hostAddress: '192.168.0.10',
      trustNewCertificate: true,
    }))
    expect(await screen.findByText('Conectado')).toBeTruthy()
  })

  it('reports a host that does not answer', async () => {
    runtime.fetchConnection.mockResolvedValue(view({ mode: 'client', hostAddress: '192.168.0.10:52480' }))
    runtime.testHostConnection.mockResolvedValue({ ok: false, library: null, latencyMs: 0, message: 'No se pudo contactar al host de Notia.' })
    render(<RunModeSection />)
    expect(await screen.findByText('No responde')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain('No se pudo contactar')
  })

  it('offers only the remote client where no copy is kept', async () => {
    runtime.fetchConnection.mockResolvedValue(view({ mode: 'client', hostAddress: 'casa:52480', canHost: false, canKeepCopy: false }))
    runtime.testHostConnection.mockResolvedValue({ ok: true, library: null, latencyMs: 1, message: null })
    render(<RunModeSection />)
    const copy = await screen.findByRole('radio', { name: /Con copia/ }) as HTMLButtonElement
    expect(copy.disabled).toBe(true)
    expect(screen.getByRole('radio', { name: /^Remoto/ }).getAttribute('aria-checked')).toBe('true')
  })

  it('asks Android for the folder of the copy before keeping it', async () => {
    const android = view({ mode: 'client', clientKind: 'remote', hostAddress: 'casa:52480', canHost: false, copyNeedsFolder: true })
    runtime.fetchConnection.mockResolvedValue(android)
    runtime.testHostConnection.mockResolvedValue({ ok: true, library: 'gaia', latencyMs: 3, message: null })
    runtime.pickCopyFolder.mockResolvedValue({ ...android, copyFolder: 'NotiaCopia' })
    runtime.saveConnection.mockResolvedValue({ connection: { ...android, clientKind: 'copy', copyFolder: 'NotiaCopia' }, reload: true })
    render(<RunModeSection />)
    fireEvent.click(await screen.findByRole('radio', { name: /Con copia/ }))
    expect(runtime.saveConnection).not.toHaveBeenCalled()
    expect(screen.getByText('Sin elegir')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Elegir carpeta' }))
    await waitFor(() => expect(runtime.saveConnection).toHaveBeenCalledWith({ mode: 'client', clientKind: 'copy', hostAddress: 'casa:52480' }))
    expect(runtime.pickCopyFolder).toHaveBeenCalledTimes(1)
  })
})
