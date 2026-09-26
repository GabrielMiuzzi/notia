import { backendSupports, callBackend } from '../transport'

/*
 * Gmail accounts connected to a library, each identified by its address and
 * marked as work, personal or school. Whoever installs Notia uses their own
 * Google Cloud project: its OAuth client (Client ID and Client secret) is
 * stored in the library configuration, like the Ollama API key. Rust runs
 * the OAuth flow in the browser and keeps the client and the tokens; the
 * interface only sees whether they are configured and the addresses.
 */

export type MailProviderId = 'gmail'
export type MailAccountType = 'laboral' | 'personal' | 'estudiantil'

export interface MailProviderView {
  provider: MailProviderId
  label: string
  /** The library has a Google Cloud client to connect it. */
  configured: boolean
}

export interface MailAccountView {
  provider: MailProviderId
  label: string
  email: string
  connectedAtMs: number
  accountType: MailAccountType
}

export interface MailAccountsView {
  googleCloudConfigured: boolean
  providers: MailProviderView[]
  accounts: MailAccountView[]
}

export interface GoogleCloudCredentials {
  clientId: string
  clientSecret: string
}

/** A refused operation; `cancelled` when the person stopped it. */
export class MailAccountError extends Error {
  readonly cancelled: boolean

  constructor(message: string, cancelled: boolean) {
    super(message)
    this.cancelled = cancelled
  }
}

async function call<T>(command: string, payload: Record<string, unknown> | undefined, fallback: string): Promise<T> {
  try {
    return await callBackend<T>(command, payload ? { payload } : undefined)
  } catch (error) {
    const detail = error && typeof error === 'object' ? error as { message?: unknown; code?: unknown } : {}
    const message = typeof detail.message === 'string' && detail.message.trim()
      ? detail.message
      : error instanceof Error && error.message.trim() ? error.message : fallback
    throw new MailAccountError(message, detail.code === 'cancelled')
  }
}

export function readMailAccounts(libraryId: string): Promise<MailAccountsView> {
  return call('backend_mail_accounts', { libraryId }, 'No se pudieron leer las cuentas conectadas.')
}

export function saveGoogleCloudCredentials(libraryId: string, credentials: GoogleCloudCredentials): Promise<MailAccountsView> {
  return call('backend_save_google_cloud_credentials', { libraryId, ...credentials }, 'No se pudieron guardar las credenciales.')
}

/** Asks Google whether the Client ID and Client secret belong together. */
export function checkGoogleCloudCredentials(credentials: GoogleCloudCredentials): Promise<void> {
  return call('backend_check_google_cloud_credentials', { ...credentials }, 'No se pudo probar la conexión.')
}

/** Removes the credentials and the Gmail account of the library. */
export function removeGoogleCloudCredentials(libraryId: string): Promise<MailAccountsView> {
  return call('backend_remove_google_cloud_credentials', { libraryId }, 'No se pudieron eliminar las credenciales.')
}

/** Picks the JSON Google downloads; `null` when the picker was closed. */
export function importGoogleCloudJson(): Promise<GoogleCloudCredentials | null> {
  return call('backend_import_google_cloud_json', undefined, 'No se pudo importar el JSON.')
}

/** The file picker and the browser run on the computer running Notia. */
export function canImportGoogleCloudJson(): boolean {
  return backendSupports('backend_import_google_cloud_json')
}

export function canConnectMailAccounts(): boolean {
  return backendSupports('backend_connect_mail_account')
}

/**
 * Opens the browser to sign in; resolves once the account is stored. With
 * `email` it reconnects that account (Google suggests its address).
 */
export function connectMailAccount(libraryId: string, provider: MailProviderId, email?: string): Promise<MailAccountsView> {
  return call('backend_connect_mail_account', { libraryId, provider, email }, 'No se pudo conectar la cuenta.')
}

export function cancelMailAccountConnection(): Promise<void> {
  return call('backend_cancel_mail_account_connection', undefined, 'No se pudo cancelar la conexión.')
}

export function disconnectMailAccount(libraryId: string, email: string): Promise<MailAccountsView> {
  return call('backend_disconnect_mail_account', { libraryId, email }, 'No se pudo desconectar la cuenta.')
}

export function setMailAccountType(libraryId: string, email: string, accountType: MailAccountType): Promise<MailAccountsView> {
  return call('backend_set_mail_account_type', { libraryId, email, accountType }, 'No se pudo cambiar el tipo de cuenta.')
}
