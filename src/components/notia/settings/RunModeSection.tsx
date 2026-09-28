import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { FolderOpen, Pencil } from 'lucide-react'
import { NotiaButton } from '../../common/NotiaButton'
import { SettingsCard, SettingsFooter } from './SettingsControls'
import {
  fetchConnection,
  pickCopyFolder,
  saveConnection,
  testHostConnection,
  type ClientKind,
  type ConnectionView,
  type CopyStatus,
  type RunMode,
} from '../../../services/connection/connectionRuntime'

type HostTest = 'idle' | 'testing' | 'ok' | 'fail'

function messageOf(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message
  return fallback
}

function copySummary(copy: CopyStatus): string {
  const at = new Date(copy.atMs).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })
  if (copy.error) return `La copia local no se sincronizó (${at}): ${copy.error}`
  const skipped = copy.skipped.length ? ` ${copy.skipped.length} archivo(s) no viajaron: ${copy.skipped.slice(0, 3).join(', ')}.` : ''
  return `Copia local sincronizada a las ${at}.${skipped}`
}

function ModeOption({ checked, title, description, onPick, disabled }: {
  checked: boolean
  title: string
  description: string
  onPick: () => void
  disabled?: boolean
}) {
  return (
    <button type="button" role="radio" aria-checked={checked} className="notia-settings-mode-option" disabled={disabled} onClick={onPick}>
      <span className="notia-settings-mode-radio" aria-hidden="true"><span /></span>
      <span className="notia-settings-mode-option-text">
        <span className="notia-settings-mode-option-title">{title}</span>
        <span className="notia-settings-mode-option-description">{description}</span>
      </span>
    </button>
  )
}

function Radios({ label, labelledBy, children }: { label?: string; labelledBy?: string; children: ReactNode }) {
  return <div role="radiogroup" aria-label={label} aria-labelledby={labelledBy} className="notia-settings-mode-options">{children}</div>
}

/**
 * «Modo de ejecución» (Settings canvas, boards «General · Host», «General ·
 * Cliente conectado» and «General · Cliente sin conexión»). Rust stores the
 * mode, starts the server or the link with the host and tests it; a change
 * that alters how the window reaches the backend reloads it.
 */
export function RunModeSection() {
  const [connection, setConnection] = useState<ConnectionView | null>(null)
  // «Cliente» picked but not saved yet: it applies with the host's address.
  const [pendingClient, setPendingClient] = useState(false)
  const [kind, setKind] = useState<ClientKind>('copy')
  const [editing, setEditing] = useState(false)
  const [address, setAddress] = useState('')
  const [test, setTest] = useState<HostTest>('idle')
  const [testMessage, setTestMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const runTest = useCallback(async () => {
    setTest('testing')
    setTestMessage(null)
    try {
      const probe = await testHostConnection()
      setTest(probe.ok ? 'ok' : 'fail')
      setTestMessage(probe.ok ? null : probe.message)
    } catch (reason) {
      setTest('fail')
      setTestMessage(messageOf(reason, 'No se pudo probar la conexión.'))
    }
  }, [])

  useEffect(() => {
    let active = true
    fetchConnection()
      .then((view) => {
        if (!active) return
        setConnection(view)
        setKind(view.canKeepCopy ? view.clientKind : 'remote')
        setAddress(view.hostAddress)
        if (view.mode === 'client') void runTest()
      })
      .catch((reason: unknown) => { if (active) setError(messageOf(reason, 'No se pudo leer el modo de ejecución.')) })
    return () => { active = false }
  }, [runTest])

  if (!connection) {
    return error ? <SettingsCard><SettingsFooter tone="error" message={error} /></SettingsCard> : null
  }

  const mode: RunMode = connection.mode === 'client' || pendingClient ? 'client' : 'host'
  const isSavedClient = connection.mode === 'client'

  const save = async (next: { mode: RunMode; clientKind: ClientKind; hostAddress: string; trustNewCertificate?: boolean }) => {
    setBusy(true)
    setError(null)
    try {
      const saved = await saveConnection(next)
      if (saved.reload) {
        window.location.reload()
        return
      }
      setConnection(saved.connection)
      setAddress(saved.connection.hostAddress)
      setEditing(false)
      setPendingClient(false)
      if (saved.connection.mode === 'client') void runTest()
    } catch (reason) {
      setError(messageOf(reason, 'No se pudo guardar el modo de ejecución.'))
    } finally {
      setBusy(false)
    }
  }

  const pickHost = () => {
    setPendingClient(false)
    setEditing(false)
    setError(null)
    if (isSavedClient) void save({ mode: 'host', clientKind: kind, hostAddress: connection.hostAddress })
  }

  const pickClient = () => {
    if (isSavedClient) return
    setPendingClient(true)
    setEditing(true)
  }

  // Android keeps the copy in a folder the person chooses first.
  const copyNeedsFolder = connection.copyNeedsFolder && !connection.copyFolder

  const pickKind = (next: ClientKind) => {
    setKind(next)
    if (next === 'copy' && copyNeedsFolder) return
    if (isSavedClient && next !== connection.clientKind) void save({ mode: 'client', clientKind: next, hostAddress: connection.hostAddress })
  }

  const chooseCopyFolder = async () => {
    setBusy(true)
    setError(null)
    try {
      const next = await pickCopyFolder()
      setConnection(next)
      if (isSavedClient && kind === 'copy' && next.clientKind !== 'copy') {
        await save({ mode: 'client', clientKind: 'copy', hostAddress: next.hostAddress })
      }
    } catch (reason) {
      setError(messageOf(reason, 'No se pudo elegir la carpeta de la copia.'))
    } finally {
      setBusy(false)
    }
  }

  const submitAddress = (event: FormEvent) => {
    event.preventDefault()
    if (!address.trim() || busy) return
    void save({ mode: 'client', clientKind: kind, hostAddress: address, trustNewCertificate: true })
  }

  const cancelEditing = () => {
    setEditing(false)
    setAddress(connection.hostAddress)
    if (!isSavedClient) setPendingClient(false)
  }

  const hostTone = test === 'testing' || test === 'idle' ? 'testing' : test
  const hostLabel = test === 'ok' ? 'Conectado' : test === 'fail' ? 'No responde' : 'Probando…'
  const server = connection.server

  return (
    <SettingsCard>
      <div className="notia-settings-mode" aria-busy={busy}>
        <div className="notia-settings-block">
          <div className="notia-settings-block-title">Modo de ejecución</div>
          <div className="notia-settings-row-description">Define si esta instalación comparte su biblioteca o se conecta a la de otro equipo.</div>
        </div>
        <Radios label="Modo de ejecución">
          <ModeOption
            checked={mode === 'host'}
            title="Host"
            description={connection.canHost
              ? 'Esta instalación guarda la biblioteca y la comparte con los clientes.'
              : 'Este dispositivo usa su propia biblioteca. Android no la comparte con otros equipos.'}
            disabled={busy}
            onPick={pickHost}
          />
          <ModeOption
            checked={mode === 'client'}
            title="Cliente"
            description="Se conecta a un host de Notia para usar su biblioteca."
            disabled={busy}
            onPick={pickClient}
          />
        </Radios>
      </div>

      {mode === 'host' && connection.canHost ? (
        <div className="notia-settings-row" data-inline>
          <div className="notia-settings-row-text">
            <div className="notia-settings-row-label"><span>Puerto</span></div>
            <div className="notia-settings-row-description">
              {server.error ?? 'Los clientes se conectan a esta instalación por este puerto.'}
            </div>
          </div>
          <div className="notia-settings-row-control">
            <span className="notia-settings-listening" data-on={server.listening || undefined} role="status">
              <span aria-hidden="true" />{server.listening ? 'Escuchando' : 'Sin escuchar'}
            </span>
            <span className="notia-settings-value">{server.port}</span>
          </div>
        </div>
      ) : null}

      {mode === 'client' ? (
        <div className="notia-settings-mode-client">
          <div id="notia-settings-client-kind" className="notia-settings-row-label"><span>Tipo de cliente</span></div>
          <Radios labelledBy="notia-settings-client-kind">
            <ModeOption
              checked={kind === 'copy'}
              title="Con copia"
              description={connection.canKeepCopy
                ? 'Guarda una copia local sincronizada. Podés seguir trabajando sin conexión.'
                : 'Este dispositivo no guarda copias: usá Remoto.'}
              disabled={busy || !connection.canKeepCopy}
              onPick={() => pickKind('copy')}
            />
            <ModeOption
              checked={kind === 'remote'}
              title="Remoto"
              description="Trabaja directo sobre el host, sin guardar la biblioteca en este dispositivo."
              disabled={busy}
              onPick={() => pickKind('remote')}
            />
          </Radios>

          {kind === 'copy' && connection.copyNeedsFolder ? (
            <div className="notia-settings-host">
              <div className="notia-settings-row-label"><span>Carpeta de la copia</span></div>
              <div className="notia-settings-row-description">
                Carpeta de este dispositivo donde se guarda la biblioteca para usarla sin conexión. Tiene que estar vacía.
              </div>
              <div className="notia-settings-host-row notia-settings-copy-folder">
                <FolderOpen size={16} aria-hidden="true" />
                <span className="notia-settings-copy-folder-name" data-empty={connection.copyFolder ? undefined : true}>
                  {connection.copyFolder ?? 'Sin elegir'}
                </span>
                <span className="notia-settings-host-spacer" />
                <NotiaButton disabled={busy} onClick={() => { void chooseCopyFolder() }}>
                  {connection.copyFolder ? 'Cambiar carpeta' : 'Elegir carpeta'}
                </NotiaButton>
              </div>
            </div>
          ) : null}

          <div className="notia-settings-host">
            <div className="notia-settings-row-label"><span>Host</span></div>
            <div className="notia-settings-row-description">Equipo donde corre Notia en modo Host.</div>
            {editing || !isSavedClient ? (
              <form className="notia-settings-host-edit" onSubmit={submitAddress}>
                <input
                  type="text"
                  className="notia-settings-field notia-settings-field--grow notia-settings-field--mono"
                  aria-label="Dirección del host"
                  placeholder="[host]:[puerto]"
                  inputMode="url"
                  autoComplete="off"
                  spellCheck={false}
                  value={address}
                  onChange={(event) => setAddress(event.target.value)}
                />
                <NotiaButton disabled={busy} onClick={cancelEditing}>Cancelar</NotiaButton>
                <NotiaButton type="submit" variant="primary" disabled={busy || !address.trim()}>Guardar</NotiaButton>
              </form>
            ) : (
              <div className="notia-settings-host-row" data-tone={hostTone}>
                <span className="notia-settings-host-dot" aria-hidden="true" />
                <span className="notia-settings-host-address">{connection.hostAddress}</span>
                <span className="notia-settings-host-state" role="status">{hostLabel}</span>
                <span className="notia-settings-host-spacer" />
                <NotiaButton aria-label="Editar dirección del host" disabled={busy} onClick={() => setEditing(true)}>
                  <Pencil size={14} aria-hidden="true" />Editar
                </NotiaButton>
                <NotiaButton aria-busy={test === 'testing'} disabled={busy || test === 'testing'} onClick={() => { void runTest() }}>
                  Probar conexión
                </NotiaButton>
              </div>
            )}
            {isSavedClient && !editing && test === 'fail' && testMessage ? (
              <p className="notia-settings-note notia-settings-host-message" role="alert">{testMessage}</p>
            ) : null}
            {isSavedClient && connection.clientKind === 'copy' && connection.copy ? (
              <p className="notia-settings-note notia-settings-host-message" role={connection.copy.error ? 'alert' : 'status'}>
                {copySummary(connection.copy)}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      {error ? <SettingsFooter tone="error" message={error} /> : null}
      {pendingClient && !error ? (
        <SettingsFooter message="Guardá la dirección del host para pasar a modo cliente. La ventana se recarga al cambiar de modo." />
      ) : null}
    </SettingsCard>
  )
}
