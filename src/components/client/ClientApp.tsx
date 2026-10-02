import { lazy, Suspense, useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
// The screens before the app (sign-in, connection) use the app's styles and
// theme tokens, which otherwise load only with the app.
import '../../styles/notia.css'
import { installBackendTransport, subscribeBackend } from '../../services/transport'
import { createHostTransport } from '../../services/transport/hostTransport'
import {
  HOST_LINK_EVENT,
  leaveOfflineCopy,
  openClient,
  saveConnection,
  type ConnectionView,
  type HostLink,
} from '../../services/connection/connectionRuntime'
import {
  APP_AUTH_CHANGED_EVENT,
  authErrorMessage,
  fetchAppAuthStatus,
  type AppAuthStatus,
} from '../../services/auth/appAuthRuntime'
import { LoginScreen } from '../notia/auth/LoginScreen'

// Loaded after the host transport is installed: modules of the interface
// read which backend they talk to when they load.
const App = lazy(() => import('../../App'))

type Stage =
  | { kind: 'checking' }
  | { kind: 'offline'; message: string }
  | { kind: 'login'; status: AppAuthStatus & { libraryId: string } }
  | { kind: 'ready' }
  /** «Con copia» without the host: the app works on the local copy. */
  | { kind: 'copy' }

/** Seconds the window waits, once the host answers again, before going back
 * to it: the editor saves what the person was writing meanwhile. */
const RETURN_DELAY_SECONDS = 5

function prefersLightTheme(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: light)').matches
}

function ClientScreen({ library, children }: { library?: string | null; children: ReactNode }) {
  return (
    <div className={`notia-app-shell ${prefersLightTheme() ? 'notia-theme-light' : 'notia-theme-dark'}`}>
      <div className="notia-login-screen">
        <main className="notia-login-card">
          <div className="notia-login-brand">
            <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
              <path d="M8 4h9l5 5v13a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />
              <path d="M17 4v5h5" />
              <path d="M10 15h8M10 19h5" />
            </svg>
            <span className="notia-login-brand-name">Notia</span>
            {library ? <span className="notia-login-library">{library}</span> : null}
          </div>
          {children}
        </main>
      </div>
    </div>
  )
}

/** The host does not answer: retry, point to another host or use this device. */
function OfflineScreen({ connection, message, onRetry }: { connection: ConnectionView; message: string; onRetry: () => void }) {
  const [address, setAddress] = useState(connection.hostAddress)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const apply = async (input: Parameters<typeof saveConnection>[0]) => {
    setBusy(true)
    setError(null)
    try {
      await saveConnection(input)
      window.location.reload()
    } catch (reason) {
      setError(authErrorMessage(reason, 'No se pudo guardar el modo de ejecución.'))
      setBusy(false)
    }
  }

  const submitAddress = (event: FormEvent) => {
    event.preventDefault()
    if (!address.trim() || busy) return
    void apply({ mode: 'client', clientKind: connection.clientKind, hostAddress: address, trustNewCertificate: true })
  }

  return (
    <ClientScreen>
      <form className="notia-login-body" onSubmit={submitAddress} noValidate aria-busy={busy}>
        <div className="notia-login-heading">
          <h1>Sin conexión con el host</h1>
          <p>{message}</p>
        </div>
        <div className="notia-login-fields">
          <div className="notia-login-field">
            <label htmlFor="client-host-address">Host</label>
            <input
              id="client-host-address"
              className="notia-login-input notia-client-address"
              type="text"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              placeholder="[host]:[puerto]"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
            />
          </div>
        </div>
        <div className="notia-login-actions">
          {error ? <p className="notia-login-error" role="alert">{error}</p> : null}
          <button type="button" className="notia-login-primary" disabled={busy} onClick={onRetry}>Reintentar</button>
          {address.trim() && address.trim() !== connection.hostAddress ? (
            <button type="submit" className="notia-login-link" disabled={busy}>Guardar esta dirección</button>
          ) : null}
          <button
            type="button"
            className="notia-login-link"
            disabled={busy}
            onClick={() => { void apply({ mode: 'host', clientKind: connection.clientKind, hostAddress: connection.hostAddress }) }}
          >
            {connection.canHost ? 'Usar este equipo como host' : 'Usar la biblioteca de este dispositivo'}
          </button>
        </div>
      </form>
    </ClientScreen>
  )
}

/**
 * Window of a client (Settings → General → «Modo de ejecución»): the
 * backend decides where it opens (`openClient`): on the host, after signing
 * in with the Owner of its library, or on the copy when the host does not
 * answer. The copy syncs in the background; the window never waits for it.
 */
export function ClientApp({ initial }: { initial: ConnectionView }) {
  const [connection, setConnection] = useState(initial)
  const [stage, setStage] = useState<Stage>({ kind: 'checking' })
  const [link, setLink] = useState<HostLink>(initial.link)
  const [returnIn, setReturnIn] = useState<number | null>(null)

  const check = useCallback(async () => {
    setStage({ kind: 'checking' })
    const opened = await openClient()
    const next = opened.connection
    setConnection(next)
    if (opened.opening === 'copy') {
      setStage({ kind: 'copy' })
      return
    }
    if (opened.opening === 'offline') {
      setStage({ kind: 'offline', message: opened.message ?? '' })
      return
    }
    installBackendTransport(createHostTransport({ hostPlatform: next.link.platform, hostOnlyCommands: next.hostOnlyCommands }))
    const status = await fetchAppAuthStatus(null)
    if ((status.state === 'locked' || status.state === 'setup') && status.libraryId) {
      setStage({ kind: 'login', status: { ...status, libraryId: status.libraryId } })
      return
    }
    setStage({ kind: 'ready' })
  }, [])

  useEffect(() => {
    void check().catch((reason: unknown) => {
      setStage({ kind: 'offline', message: authErrorMessage(reason, 'No se pudo conectar con el host.') })
    })
  }, [check])

  // While the app is open: a banner when the host stops answering, and the
  // sign-in window again when the host ends the session.
  useEffect(() => {
    let unsubscribe: (() => void) | null = null
    let active = true
    void subscribeBackend<HostLink>(HOST_LINK_EVENT, (next) => {
      setLink((previous) => {
        if (previous.signedIn && !next.signedIn) window.dispatchEvent(new Event(APP_AUTH_CHANGED_EVENT))
        return next
      })
    }).then((stop) => {
      if (active) unsubscribe = stop
      else stop()
    })
    return () => {
      active = false
      unsubscribe?.()
    }
  }, [])

  // Working on the copy: once the host answers again, back to it.
  const hostBack = stage.kind === 'copy' && link.state === 'online'
  useEffect(() => {
    if (!hostBack) {
      setReturnIn(null)
      return
    }
    setReturnIn(RETURN_DELAY_SECONDS)
    const timer = window.setInterval(() => {
      setReturnIn((seconds) => (seconds === null ? null : Math.max(0, seconds - 1)))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [hostBack])

  const returnToHost = useCallback(() => {
    void leaveOfflineCopy().finally(() => window.location.reload())
  }, [])

  useEffect(() => {
    if (returnIn === 0) returnToHost()
  }, [returnIn, returnToHost])

  if (stage.kind === 'copy') {
    return (
      <>
        <div className="notia-remote-banner notia-client-banner" data-tone={hostBack ? 'online' : undefined} role="status">
          {hostBack ? (
            <>
              <span>El host volvió a responder. Volviendo en {returnIn ?? RETURN_DELAY_SECONDS} s; la copia se sincroniza en segundo plano.</span>
              <button type="button" className="notia-client-banner-action" onClick={returnToHost}>Volver ahora</button>
            </>
          ) : (
            <span>Sin conexión con el host: trabajás con la copia local. La base de datos es de solo lectura.</span>
          )}
        </div>
        <Suspense fallback={<ClientScreen><p className="notia-login-text" role="status">Cargando Notia…</p></ClientScreen>}>
          <App />
        </Suspense>
      </>
    )
  }

  if (stage.kind === 'ready') {
    return (
      <>
        {link.state === 'offline' ? (
          <div className="notia-remote-banner notia-client-banner" role="alert">
            <span>{link.message ?? 'Sin conexión con el host. Reintentando…'}</span>
            {connection.clientKind === 'copy' && connection.canKeepCopy ? (
              <button type="button" className="notia-client-banner-action" onClick={() => window.location.reload()}>Usar la copia local</button>
            ) : null}
          </div>
        ) : null}
        <Suspense fallback={<ClientScreen><p className="notia-login-text" role="status">Cargando Notia…</p></ClientScreen>}>
          <App />
        </Suspense>
      </>
    )
  }
  if (stage.kind === 'login') {
    return (
      <div className={`notia-app-shell ${prefersLightTheme() ? 'notia-theme-light' : 'notia-theme-dark'}`}>
        <LoginScreen status={stage.status} canRemember onUnlocked={() => setStage({ kind: 'ready' })} />
      </div>
    )
  }
  if (stage.kind === 'offline') {
    return (
      <OfflineScreen
        connection={connection}
        message={stage.message}
        onRetry={() => {
          void check().catch((reason: unknown) => {
            setStage({ kind: 'offline', message: authErrorMessage(reason, 'No se pudo conectar con el host.') })
          })
        }}
      />
    )
  }
  return (
    <ClientScreen library={connection.link.library}>
      <p className="notia-login-text" role="status">Conectando con el host {connection.hostAddress}…</p>
    </ClientScreen>
  )
}
