// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { MailAccountsView, MailAccountType } from '../../../services/mail/mailAccountsRuntime'

const runtime = vi.hoisted(() => ({
  readMailAccounts: vi.fn(),
  saveGoogleCloudCredentials: vi.fn(),
  checkGoogleCloudCredentials: vi.fn(),
  removeGoogleCloudCredentials: vi.fn(),
  importGoogleCloudJson: vi.fn(),
  connectMailAccount: vi.fn(),
  disconnectMailAccount: vi.fn(),
  setMailAccountType: vi.fn(),
  cancelMailAccountConnection: vi.fn(),
  canConnectMailAccounts: vi.fn(() => true),
  canImportGoogleCloudJson: vi.fn(() => true),
}))

vi.mock('../../../services/mail/mailAccountsRuntime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../services/mail/mailAccountsRuntime')>()),
  ...runtime,
}))

const { MailAccountsSection } = await import('./MailAccountsSection')
const { MailAccountError } = await import('../../../services/mail/mailAccountsRuntime')

const CLIENT_ID = '123-abc.apps.googleusercontent.com'
const WORK = 'ana@empresa.com'
const SCHOOL = 'ana@uni.edu'
const view = (configured: boolean, accounts: Array<[string, MailAccountType]> = []): MailAccountsView => ({
  googleCloudConfigured: configured,
  providers: [{ provider: 'gmail', label: 'Gmail', configured }],
  accounts: accounts.map(([email, accountType]) => ({ provider: 'gmail', label: 'Gmail', email, connectedAtMs: 1, accountType })),
})

describe('MailAccountsSection', () => {
  beforeEach(() => {
    Object.values(runtime).forEach((mock) => mock.mockReset())
    runtime.canConnectMailAccounts.mockReturnValue(true)
    runtime.canImportGoogleCloudJson.mockReturnValue(true)
    runtime.cancelMailAccountConnection.mockResolvedValue(undefined)
  })
  afterEach(cleanup)

  it('asks for the Google Cloud credentials first, checks and saves them', async () => {
    runtime.readMailAccounts.mockResolvedValue(view(false))
    runtime.checkGoogleCloudCredentials.mockResolvedValue(undefined)
    runtime.saveGoogleCloudCredentials.mockResolvedValue(view(true))
    render(<MailAccountsSection libraryId="lib" />)

    expect(await screen.findByText('Sin configurar')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Configurá GCP primero' }) as HTMLButtonElement).disabled).toBe(true)
    const save = screen.getByRole('button', { name: 'Guardar' }) as HTMLButtonElement
    expect(save.disabled).toBe(true)

    fireEvent.change(screen.getByLabelText('Client ID'), { target: { value: CLIENT_ID } })
    fireEvent.change(screen.getByLabelText('Client secret'), { target: { value: 'secreto' } })
    fireEvent.click(screen.getByRole('button', { name: 'Probar conexión' }))
    expect(runtime.checkGoogleCloudCredentials).toHaveBeenCalledWith({ clientId: CLIENT_ID, clientSecret: 'secreto' })
    expect(await screen.findByText('Google reconoce el cliente. Guardalo para conectar la cuenta.')).toBeTruthy()

    fireEvent.click(save)
    expect(runtime.saveGoogleCloudCredentials).toHaveBeenCalledWith('lib', { clientId: CLIENT_ID, clientSecret: 'secreto' })
    expect(await screen.findByText('GCP configurado')).toBeTruthy()
    expect(screen.queryByLabelText('Client ID')).toBeNull()
    expect((screen.getByRole('button', { name: 'Conectar cuenta de Gmail' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('fills the form from the JSON Google downloads', async () => {
    runtime.readMailAccounts.mockResolvedValue(view(false))
    runtime.importGoogleCloudJson.mockResolvedValue({ clientId: CLIENT_ID, clientSecret: 'secreto' })
    render(<MailAccountsSection libraryId="lib" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Importar JSON' }))
    await waitFor(() => expect((screen.getByLabelText('Client ID') as HTMLInputElement).value).toBe(CLIENT_ID))
    expect((screen.getByLabelText('Client secret') as HTMLInputElement).value).toBe('secreto')
    expect(screen.getByText('JSON importado. Revisá los datos y guardalos.')).toBeTruthy()
  })

  it('connects several accounts and gives each its own type', async () => {
    runtime.readMailAccounts.mockResolvedValue(view(true, [[WORK, 'laboral']]))
    runtime.connectMailAccount.mockResolvedValue(view(true, [[WORK, 'laboral'], [SCHOOL, 'personal']]))
    runtime.setMailAccountType.mockResolvedValue(view(true, [[WORK, 'laboral'], [SCHOOL, 'estudiantil']]))
    render(<MailAccountsSection libraryId="lib" />)
    expect(await screen.findByText(WORK)).toBeTruthy()

    const connect = screen.getByRole('button', { name: 'Conectar cuenta de Gmail' })
    expect(connect.textContent).toContain('Conectar otra cuenta')
    fireEvent.click(connect)
    expect(runtime.connectMailAccount).toHaveBeenCalledWith('lib', 'gmail', undefined)
    expect(await screen.findByText(`Cuenta conectada: ${SCHOOL}. Elegí su tipo abajo.`)).toBeTruthy()
    expect(screen.getByText('2 cuentas')).toBeTruthy()
    expect(screen.getByRole('button', { name: `Laboral: ${WORK}` }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: `Personal: ${SCHOOL}` }).getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(screen.getByRole('button', { name: `Estudiantil: ${SCHOOL}` }))
    expect(runtime.setMailAccountType).toHaveBeenCalledWith('lib', SCHOOL, 'estudiantil')
    await waitFor(() => expect(screen.getByRole('button', { name: `Estudiantil: ${SCHOOL}` }).getAttribute('aria-pressed')).toBe('true'))
  })

  it('reconnects an account by its address and can cancel without an error', async () => {
    runtime.readMailAccounts.mockResolvedValue(view(true, [[WORK, 'laboral'], [SCHOOL, 'estudiantil']]))
    let reject: (error: unknown) => void = () => {}
    runtime.connectMailAccount.mockReturnValue(new Promise((_resolve, fail) => { reject = fail }))
    render(<MailAccountsSection libraryId="lib" />)
    fireEvent.click(await screen.findByRole('button', { name: `Reconectar ${SCHOOL}` }))
    expect(runtime.connectMailAccount).toHaveBeenCalledWith('lib', 'gmail', SCHOOL)
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(runtime.cancelMailAccountConnection).toHaveBeenCalled()
    reject(new MailAccountError('Se canceló la conexión de la cuenta.', true))
    await waitFor(() => expect(screen.getByRole('button', { name: `Reconectar ${SCHOOL}` })).toBeTruthy())
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows why a connection failed, disconnects one account and removes the credentials', async () => {
    runtime.readMailAccounts.mockResolvedValue(view(true, [[WORK, 'laboral'], [SCHOOL, 'estudiantil']]))
    runtime.connectMailAccount.mockRejectedValue(new MailAccountError('No se otorgó el permiso a Notia.', false))
    runtime.disconnectMailAccount.mockResolvedValue(view(true, [[SCHOOL, 'estudiantil']]))
    runtime.removeGoogleCloudCredentials.mockResolvedValue(view(false))
    render(<MailAccountsSection libraryId="lib" />)
    fireEvent.click(await screen.findByRole('button', { name: `Reconectar ${WORK}` }))
    expect((await screen.findByRole('alert')).textContent).toContain('No se otorgó el permiso a Notia.')

    fireEvent.click(screen.getByRole('button', { name: `Desconectar ${WORK}` }))
    expect(runtime.disconnectMailAccount).toHaveBeenCalledWith('lib', WORK)
    await waitFor(() => expect(screen.queryByText(WORK)).toBeNull())
    expect(screen.getByText(SCHOOL)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Eliminar credenciales de GCP' }))
    expect(runtime.removeGoogleCloudCredentials).toHaveBeenCalledWith('lib')
    expect(await screen.findByText('Sin configurar')).toBeTruthy()
  })
})
