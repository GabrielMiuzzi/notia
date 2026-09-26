import { useCallback, useEffect, useState } from 'react'
import { Check, Cloud, Download, Mail, Plus } from 'lucide-react'
import { NotiaButton } from '../../common/NotiaButton'
import { SettingsBadge, SettingsCard, SettingsFooter, SettingsNotice, SettingsRow, type SettingsTone } from './SettingsControls'
import {
  cancelMailAccountConnection,
  canConnectMailAccounts,
  canImportGoogleCloudJson,
  checkGoogleCloudCredentials,
  connectMailAccount,
  disconnectMailAccount,
  importGoogleCloudJson,
  MailAccountError,
  readMailAccounts,
  removeGoogleCloudCredentials,
  saveGoogleCloudCredentials,
  setMailAccountType,
  type MailAccountsView,
  type MailAccountType,
  type MailProviderId,
} from '../../../services/mail/mailAccountsRuntime'

const PROVIDER_DETAIL: Record<MailProviderId, string> = {
  gmail: 'Cuenta de Google · correo y calendario',
}

const ACCOUNT_TYPES: ReadonlyArray<{ id: MailAccountType; label: string }> = [
  { id: 'laboral', label: 'Laboral' },
  { id: 'personal', label: 'Personal' },
  { id: 'estudiantil', label: 'Estudiantil' },
]

const GCP_STEPS = [
  'Creá un proyecto en la consola de Google Cloud.',
  'Habilitá la API de Gmail y la de Google Calendar en ese proyecto.',
  'Configurá la pantalla de consentimiento OAuth y agregá tu correo como usuario de prueba.',
  <>En Credenciales, creá un ID de cliente OAuth de tipo <b>App de escritorio</b>.</>,
  'Copiá el Client ID y el Client secret acá, o importá el JSON que descarga Google.',
]

interface MailAccountsSectionProps {
  /** Active library; the credentials and the account belong to it. */
  libraryId: string | null
}

interface Status {
  tone: SettingsTone
  message: string
}

const IDLE: Status = { tone: 'idle', message: '' }
const GCP_UNTESTED: Status = { tone: 'idle', message: 'Todavía no se probó la conexión.' }

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

function ProviderIcon({ provider, small }: { provider: MailProviderId | 'gcp'; small?: boolean }) {
  return (
    <span className="notia-settings-mail-icon" data-provider={provider} data-small={small || undefined} aria-hidden="true">
      {provider === 'gcp' ? <Cloud size={18} strokeWidth={1.8} /> : <Mail size={18} strokeWidth={1.8} />}
    </span>
  )
}

/**
 * «Cuentas asociadas»: the library's Google Cloud credentials and its Gmail
 * account. Connecting opens the browser to sign in; the backend keeps the
 * credentials and the tokens.
 */
export function MailAccountsSection({ libraryId }: MailAccountsSectionProps) {
  const [view, setView] = useState<MailAccountsView | null>(null)
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [gcpStatus, setGcpStatus] = useState<Status>(GCP_UNTESTED)
  const [gcpBusy, setGcpBusy] = useState<'check' | 'save' | 'import' | 'remove' | null>(null)
  /** Connection waiting for the browser: a new account (`email` null) or a reconnection. */
  const [connecting, setConnecting] = useState<{ provider: MailProviderId; email: string | null } | null>(null)
  /** Address of the account being disconnected or retyped. */
  const [busy, setBusy] = useState<string | null>(null)
  const [status, setStatus] = useState<Status>(IDLE)
  const canConnect = canConnectMailAccounts()
  const canImport = canImportGoogleCloudJson()

  useEffect(() => {
    if (!libraryId) return
    let active = true
    readMailAccounts(libraryId)
      .then((next) => { if (active) setView(next) })
      .catch((error: unknown) => {
        if (active) setStatus({ tone: 'error', message: messageOf(error, 'No se pudieron leer las cuentas conectadas.') })
      })
    return () => { active = false }
  }, [libraryId])

  const credentials = { clientId, clientSecret }
  const hasCredentials = clientId.trim() !== '' && clientSecret.trim() !== ''

  const runGcp = useCallback(async (kind: 'check' | 'save' | 'import' | 'remove', task: () => Promise<void>) => {
    setGcpBusy(kind)
    try {
      await task()
    } catch (error) {
      setGcpStatus({ tone: 'error', message: messageOf(error, 'No se pudo completar la operación.') })
    } finally {
      setGcpBusy(null)
    }
  }, [])

  const checkCredentials = () => runGcp('check', async () => {
    setGcpStatus({ tone: 'loading', message: 'Probando con Google…' })
    await checkGoogleCloudCredentials(credentials)
    setGcpStatus({ tone: 'success', message: 'Google reconoce el cliente. Guardalo para conectar la cuenta.' })
  })

  const saveCredentials = () => runGcp('save', async () => {
    if (!libraryId) return
    setView(await saveGoogleCloudCredentials(libraryId, credentials))
    setClientId('')
    setClientSecret('')
    setGcpStatus(GCP_UNTESTED)
  })

  const importCredentials = () => runGcp('import', async () => {
    const imported = await importGoogleCloudJson()
    if (!imported) return
    setClientId(imported.clientId)
    setClientSecret(imported.clientSecret)
    setGcpStatus({ tone: 'success', message: 'JSON importado. Revisá los datos y guardalos.' })
  })

  const removeCredentials = () => runGcp('remove', async () => {
    if (!libraryId) return
    setView(await removeGoogleCloudCredentials(libraryId))
    setGcpStatus(GCP_UNTESTED)
    setStatus(IDLE)
  })

  const connect = useCallback(async (provider: MailProviderId, email: string | null = null) => {
    if (!libraryId) return
    setConnecting({ provider, email })
    setStatus({ tone: 'loading', message: 'Completá el inicio de sesión en el navegador que se abrió.' })
    try {
      const known = new Set(view?.accounts.map((account) => account.email.toLowerCase()) ?? [])
      const next = await connectMailAccount(libraryId, provider, email ?? undefined)
      setView(next)
      const added = next.accounts.find((account) => !known.has(account.email.toLowerCase()))
      setStatus(added
        ? { tone: 'success', message: `Cuenta conectada: ${added.email}. Elegí su tipo abajo.` }
        : { tone: 'success', message: email ? `Cuenta reconectada: ${email}.` : 'Cuenta reconectada.' })
    } catch (error) {
      setStatus(error instanceof MailAccountError && error.cancelled
        ? IDLE
        : { tone: 'error', message: messageOf(error, 'No se pudo conectar la cuenta.') })
    } finally {
      setConnecting(null)
    }
  }, [libraryId, view])

  const runAccount = useCallback(async (email: string, task: () => Promise<MailAccountsView>) => {
    setBusy(email)
    try {
      setView(await task())
      setStatus(IDLE)
    } catch (error) {
      setStatus({ tone: 'error', message: messageOf(error, 'No se pudo completar la operación.') })
    } finally {
      setBusy(null)
    }
  }, [])

  if (!libraryId) {
    return <SettingsNotice tone="idle">Abrí una biblioteca para conectar cuentas.</SettingsNotice>
  }

  const accounts = view?.accounts ?? []
  const gcpConfigured = view?.googleCloudConfigured ?? false
  const hasAccount = (provider: MailProviderId) => accounts.some((account) => account.provider === provider)

  return (
    <>
      {view && !gcpConfigured ? (
        <SettingsCard>
          <div className="notia-settings-mail-gcp-head">
            <ProviderIcon provider="gcp" />
            <div className="notia-settings-mail-text">
              <div className="notia-settings-mail-name">
                <span className="notia-settings-block-title">Google Cloud (GCP)</span>
                <SettingsBadge icon={<span className="notia-settings-mail-dot" aria-hidden="true" />}>Sin configurar</SettingsBadge>
              </div>
              <div className="notia-settings-row-description">
                Notia es una app de escritorio: cada persona usa su propio proyecto de Google Cloud. Estas credenciales permiten conectar cuentas de Gmail desde esta instalación.
              </div>
            </div>
          </div>
          <div className="notia-settings-mail-steps">
            <div className="notia-settings-mail-steps-title">Cómo obtener las credenciales</div>
            <ol>
              {GCP_STEPS.map((step, index) => (
                <li key={index}><span aria-hidden="true">{index + 1}</span><span>{step}</span></li>
              ))}
            </ol>
          </div>
          <SettingsRow label="Client ID" htmlFor="notia-settings-gcp-client-id" description="Del cliente OAuth de tipo App de escritorio.">
            <input
              id="notia-settings-gcp-client-id"
              className="notia-settings-field notia-settings-field--mono notia-settings-field--wide"
              value={clientId}
              autoComplete="off"
              spellCheck={false}
              placeholder="[id-de-cliente].apps.googleusercontent.com"
              onChange={(event) => setClientId(event.target.value)}
            />
          </SettingsRow>
          <SettingsRow
            label="Client secret"
            htmlFor="notia-settings-gcp-client-secret"
            description={<>Se guarda solo en <code>.notia/notiaConfig.json</code>; no compartas ese archivo.</>}
          >
            <input
              id="notia-settings-gcp-client-secret"
              className="notia-settings-field notia-settings-field--wide"
              type="password"
              value={clientSecret}
              autoComplete="off"
              onChange={(event) => setClientSecret(event.target.value)}
            />
          </SettingsRow>
          <SettingsFooter tone={gcpBusy === 'check' ? 'loading' : gcpStatus.tone} message={gcpStatus.message}>
            {canImport ? (
              <NotiaButton disabled={gcpBusy !== null} onClick={() => { void importCredentials() }}>
                <Download size={14} aria-hidden="true" />Importar JSON
              </NotiaButton>
            ) : null}
            <NotiaButton disabled={!hasCredentials || gcpBusy !== null} onClick={() => { void checkCredentials() }}>
              {gcpBusy === 'check' ? 'Probando…' : 'Probar conexión'}
            </NotiaButton>
            <NotiaButton variant="primary" disabled={!hasCredentials || gcpBusy !== null} onClick={() => { void saveCredentials() }}>
              {gcpBusy === 'save' ? 'Guardando…' : 'Guardar'}
            </NotiaButton>
          </SettingsFooter>
        </SettingsCard>
      ) : null}

      {gcpConfigured ? (
        <SettingsCard>
          <div className="notia-settings-mail-gcp-done">
            <span className="notia-settings-mail-pill"><Check size={14} aria-hidden="true" />GCP configurado</span>
            <NotiaButton
              variant="danger"
              aria-label="Eliminar credenciales de GCP"
              disabled={gcpBusy !== null || connecting !== null}
              onClick={() => { void removeCredentials() }}
            >
              {gcpBusy === 'remove' ? 'Eliminando…' : 'Eliminar'}
            </NotiaButton>
          </div>
        </SettingsCard>
      ) : null}
      {gcpConfigured && gcpStatus.tone === 'error' ? <SettingsNotice tone="error">{gcpStatus.message}</SettingsNotice> : null}

      <SettingsCard>
        <SettingsRow
          emphasis
          label="Conectar una cuenta"
          description="Se abre el navegador para iniciar sesión en el proveedor y autorizar a Notia. Podés conectar varias cuentas y marcar cada una como laboral, personal o estudiantil. Tu contraseña nunca pasa por Notia."
        />
        <div className="notia-settings-mail-grid">
          {(view?.providers ?? []).map(({ provider, label, configured }) => (
            <div key={provider} className="notia-settings-mail-tile">
              <div className="notia-settings-mail-head">
                <ProviderIcon provider={provider} />
                <div className="notia-settings-mail-text">
                  <div className="notia-settings-list-name">{label}</div>
                  <div className="notia-settings-row-description">{PROVIDER_DETAIL[provider]}</div>
                </div>
              </div>
              {connecting?.provider === provider && connecting.email === null ? (
                <div className="notia-settings-mail-waiting">
                  <span role="status">Esperando al navegador…</span>
                  <NotiaButton variant="ghost" onClick={() => { void cancelMailAccountConnection() }}>Cancelar</NotiaButton>
                </div>
              ) : !configured ? (
                <NotiaButton className="notia-settings-mail-connect" disabled>Configurá GCP primero</NotiaButton>
              ) : (
                <>
                  <NotiaButton
                    className="notia-settings-mail-connect"
                    aria-label={`Conectar cuenta de ${label}`}
                    disabled={!canConnect || connecting !== null}
                    onClick={() => { void connect(provider) }}
                  >
                    <Plus size={14} aria-hidden="true" />{hasAccount(provider) ? 'Conectar otra cuenta' : 'Conectar'}
                  </NotiaButton>
                  {!canConnect ? <p className="notia-settings-note">Se conecta desde la computadora que ejecuta Notia.</p> : null}
                </>
              )}
            </div>
          ))}
        </div>
      </SettingsCard>

      <SettingsCard>
        <SettingsRow emphasis inline label="Cuentas conectadas">
          <span className="notia-settings-row-meta">{accounts.length === 1 ? '1 cuenta' : `${accounts.length} cuentas`}</span>
        </SettingsRow>
        {accounts.length === 0 ? (
          <div className="notia-settings-mail-empty">
            <div className="notia-settings-list-name">Todavía no hay cuentas conectadas</div>
            <div className="notia-settings-row-description">Conectá tus cuentas de Gmail arriba para empezar.</div>
          </div>
        ) : accounts.map((account, index) => (
          <div key={account.email} className="notia-settings-mail-account">
            <div className="notia-settings-list-row notia-settings-mail-account-row">
              <ProviderIcon provider={account.provider} small />
              <div className="notia-settings-mail-text">
                <div className="notia-settings-mail-name">
                  <span className="notia-settings-list-name">{account.label}</span>
                  <SettingsBadge tone="accent" icon={<span className="notia-settings-mail-dot" aria-hidden="true" />}>Conectada</SettingsBadge>
                </div>
                <div className="notia-settings-path">{account.email}</div>
              </div>
              <div className="notia-settings-mail-actions">
                {connecting?.email === account.email ? (
                  <NotiaButton variant="ghost" onClick={() => { void cancelMailAccountConnection() }}>Cancelar</NotiaButton>
                ) : (
                  <NotiaButton
                    aria-label={`Reconectar ${account.email}`}
                    disabled={!canConnect || !gcpConfigured || connecting !== null || busy !== null}
                    onClick={() => { void connect(account.provider, account.email) }}
                  >
                    Reconectar
                  </NotiaButton>
                )}
                <NotiaButton
                  variant="danger"
                  aria-label={`Desconectar ${account.email}`}
                  disabled={connecting !== null || busy !== null}
                  onClick={() => { void runAccount(account.email, () => disconnectMailAccount(libraryId, account.email)) }}
                >
                  {busy === account.email ? 'Guardando…' : 'Desconectar'}
                </NotiaButton>
              </div>
            </div>
            <div className="notia-settings-mail-type">
              <span id={`notia-settings-mail-type-${index}`} className="notia-settings-row-meta">Tipo de cuenta</span>
              <div className="notia-settings-segmented" role="group" aria-labelledby={`notia-settings-mail-type-${index}`}>
                {ACCOUNT_TYPES.map((type) => (
                  <NotiaButton
                    key={type.id}
                    aria-pressed={account.accountType === type.id}
                    aria-label={`${type.label}: ${account.email}`}
                    disabled={busy !== null}
                    onClick={() => {
                      if (account.accountType !== type.id) {
                        void runAccount(account.email, () => setMailAccountType(libraryId, account.email, type.id))
                      }
                    }}
                  >
                    {type.label}
                  </NotiaButton>
                ))}
              </div>
            </div>
          </div>
        ))}
      </SettingsCard>

      {status.tone !== 'idle' ? <SettingsNotice tone={status.tone}>{status.message}</SettingsNotice> : null}

      <p className="notia-settings-note">
        Los tokens de acceso se guardan en <code>.notia/notiaConfig.json</code> de la biblioteca activa, igual que la API key. Desconectar borra el token de esta biblioteca.
      </p>
    </>
  )
}
