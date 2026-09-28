import { useState, type FormEvent, type ReactNode } from 'react'
import {
  authErrorMessage,
  changeOwnerPassword,
  checkFirstLogin,
  createOwnerPassword,
  loginApp,
  type AppAuthStatus,
} from '../../../services/auth/appAuthRuntime'

const MIN_PASSWORD_LENGTH = 8

type Screen = 'login' | 'crear' | 'cambiar'

interface Hint {
  text: string
  tone: 'muted' | 'warning' | 'danger' | 'ok'
}

/** Guidance under the new-password fields, as the design shows it. */
function passwordHint(nueva: string, repetir: string, actual?: string): Hint {
  if (!nueva && !repetir) return { text: 'Usá al menos 8 caracteres.', tone: 'muted' }
  if (nueva.length < MIN_PASSWORD_LENGTH) return { text: 'Usá al menos 8 caracteres.', tone: 'warning' }
  if (actual && nueva === actual) return { text: 'La nueva contraseña tiene que ser distinta de la actual.', tone: 'warning' }
  if (!repetir) return { text: 'Repetí la contraseña para confirmarla.', tone: 'muted' }
  if (nueva !== repetir) return { text: 'Las contraseñas no coinciden.', tone: 'danger' }
  return { text: 'Las contraseñas coinciden.', tone: 'ok' }
}

function Switch({ checked, label, onChange }: { checked: boolean; label: string; onChange: (checked: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className="notia-login-switch" onClick={() => onChange(!checked)}>
      <span className="notia-login-switch-track" data-on={checked || undefined}>
        <span className="notia-login-switch-knob" />
      </span>
    </button>
  )
}

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="notia-login-field">
      <label htmlFor={id}>{label}</label>
      {children}
    </div>
  )
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="notia-login-back" onClick={onClick}>
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
      Volver
    </button>
  )
}

interface LoginScreenProps {
  status: AppAuthStatus & { libraryId: string }
  /** «Recordar sesión» and «Recordar datos» keep secrets on this device;
   * a browser of a headless server does not offer them. */
  canRemember: boolean
  onUnlocked: (status: AppAuthStatus) => void
}

/**
 * Sign-in window of the Owner (design «Ventana de login»): sign in, first
 * time (user name, then the new password) and change the password. The
 * backend checks everything; this only keeps what the person types.
 */
export function LoginScreen({ status, canRemember, onUnlocked }: LoginScreenProps) {
  const libraryId = status.libraryId
  const [screen, setScreen] = useState<Screen>('login')
  const [primer, setPrimer] = useState(status.state === 'setup')
  const [usuario, setUsuario] = useState(status.remembered?.username ?? '')
  const [clave, setClave] = useState(status.remembered?.password ?? '')
  const [verClave, setVerClave] = useState(false)
  const [recordarSesion, setRecordarSesion] = useState(status.sessionRemembered)
  const [recordarDatos, setRecordarDatos] = useState(Boolean(status.remembered))
  const [actual, setActual] = useState('')
  const [nueva, setNueva] = useState('')
  const [repetir, setRepetir] = useState('')
  const [aviso, setAviso] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const clearPasswords = () => {
    setActual('')
    setNueva('')
    setRepetir('')
  }
  const go = (next: Screen) => {
    setError(null)
    setScreen(next)
  }
  const run = async (task: () => Promise<void>, fallback: string) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await task()
    } catch (reason) {
      setError(authErrorMessage(reason, fallback))
    } finally {
      setBusy(false)
    }
  }

  const nuevaOk = nueva.length >= MIN_PASSWORD_LENGTH && nueva === repetir
  const canLogin = Boolean(usuario.trim()) && Boolean(clave) && !busy
  const canContinue = Boolean(usuario.trim()) && !busy
  const canCreate = nuevaOk && !busy
  const canChange = Boolean(usuario.trim()) && Boolean(actual) && nuevaOk && nueva !== actual && !busy

  const submitLogin = (event: FormEvent) => {
    event.preventDefault()
    if (primer) {
      if (!canContinue) return
      void run(async () => {
        await checkFirstLogin(libraryId, usuario.trim())
        clearPasswords()
        go('crear')
      }, 'No se pudo continuar.')
      return
    }
    if (!canLogin) return
    void run(async () => {
      const next = await loginApp({
        libraryId,
        username: usuario.trim(),
        password: clave,
        rememberSession: canRemember && recordarSesion,
        rememberData: canRemember && recordarDatos,
      })
      onUnlocked(next)
    }, 'No se pudo iniciar sesión.')
  }

  const submitCrear = (event: FormEvent) => {
    event.preventDefault()
    if (!canCreate) return
    void run(async () => {
      await createOwnerPassword(libraryId, usuario.trim(), nueva)
      clearPasswords()
      setPrimer(false)
      setClave('')
      setAviso('Contraseña creada. Ya podés ingresar.')
      go('login')
    }, 'No se pudo guardar la contraseña.')
  }

  const submitCambiar = (event: FormEvent) => {
    event.preventDefault()
    if (!canChange) return
    void run(async () => {
      await changeOwnerPassword(libraryId, usuario.trim(), actual, nueva)
      clearPasswords()
      setClave('')
      setAviso('Contraseña actualizada. Ingresá con la nueva.')
      go('login')
    }, 'No se pudo cambiar la contraseña.')
  }

  const errorLine = error ? <p className="notia-login-error" role="alert">{error}</p> : null

  return (
    <div className="notia-login-screen">
      <main className="notia-login-card" aria-busy={busy}>
        <div className="notia-login-brand">
          <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
            <path d="M8 4h9l5 5v13a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />
            <path d="M17 4v5h5" />
            <path d="M10 15h8M10 19h5" />
          </svg>
          <span className="notia-login-brand-name">Notia</span>
          {status.libraryName ? <span className="notia-login-library">{status.libraryName}</span> : null}
        </div>

        {screen === 'login' ? (
          <form className="notia-login-body" onSubmit={submitLogin} noValidate>
            <div className="notia-login-heading">
              <h1>Iniciar sesión</h1>
              <p>Ingresá con tu usuario de Notia.</p>
            </div>

            {aviso ? (
              <div className="notia-login-notice" role="status">
                <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l5 5 9-10" /></svg>
                <span>{aviso}</span>
              </div>
            ) : null}

            <div className="notia-login-first" data-on={primer || undefined}>
              <div className="notia-login-switch-text">
                <span className="notia-login-switch-title">Primer inicio</span>
                <span className="notia-login-switch-description">Todavía no tengo contraseña</span>
              </div>
              <Switch checked={primer} label="Primer inicio" onChange={(on) => { setPrimer(on); setAviso(null); setError(null) }} />
            </div>

            <div className="notia-login-fields">
              <Field id="login-usuario" label="Usuario">
                <input id="login-usuario" className="notia-login-input" type="text" autoComplete="username" value={usuario} onChange={(event) => setUsuario(event.target.value)} />
              </Field>
              {!primer ? (
                <Field id="login-clave" label="Contraseña">
                  <div className="notia-login-password">
                    <input
                      id="login-clave"
                      className="notia-login-input"
                      type={verClave ? 'text' : 'password'}
                      autoComplete="current-password"
                      value={clave}
                      onChange={(event) => setClave(event.target.value)}
                    />
                    <button type="button" className="notia-login-eye" aria-label={verClave ? 'Ocultar contraseña' : 'Mostrar contraseña'} onClick={() => setVerClave(!verClave)}>
                      <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
                        <circle cx="12" cy="12" r="3" />
                        {verClave ? <path d="M4 4l16 16" /> : null}
                      </svg>
                    </button>
                  </div>
                </Field>
              ) : null}
            </div>

            {!primer && canRemember ? (
              <div className="notia-login-options">
                <div className="notia-login-option">
                  <div className="notia-login-switch-text">
                    <span className="notia-login-switch-title">Recordar sesión</span>
                    <span className="notia-login-switch-description">Mantener la sesión abierta en este equipo</span>
                  </div>
                  <Switch checked={recordarSesion} label="Recordar sesión" onChange={setRecordarSesion} />
                </div>
                <div className="notia-login-option">
                  <div className="notia-login-switch-text">
                    <span className="notia-login-switch-title">Recordar datos</span>
                    <span className="notia-login-switch-description">Guardar usuario y contraseña en este equipo</span>
                  </div>
                  <Switch checked={recordarDatos} label="Recordar datos" onChange={setRecordarDatos} />
                </div>
              </div>
            ) : null}

            {primer ? <p className="notia-login-text">En el siguiente paso vas a crear la contraseña de este usuario.</p> : null}

            <div className="notia-login-actions">
              {errorLine}
              {primer ? (
                <button type="submit" className="notia-login-primary" disabled={!canContinue}>{busy ? 'Revisando…' : 'Continuar'}</button>
              ) : (
                <>
                  <button type="submit" className="notia-login-primary" disabled={!canLogin}>{busy ? 'Ingresando…' : 'Login'}</button>
                  <button type="button" className="notia-login-link" onClick={() => { clearPasswords(); setAviso(null); go('cambiar') }}>Cambiar contraseña</button>
                </>
              )}
            </div>
          </form>
        ) : null}

        {screen === 'crear' ? (
          <form className="notia-login-body" onSubmit={submitCrear} noValidate>
            <div className="notia-login-heading">
              <BackButton onClick={() => { setPrimer(true); go('login') }} />
              <h1>Creá tu contraseña</h1>
              <p>Va a ser la contraseña de {usuario.trim() || 'tu usuario'}.</p>
            </div>
            <div className="notia-login-fields">
              <Field id="crear-nueva" label="Contraseña">
                <input id="crear-nueva" className="notia-login-input" type="password" autoComplete="new-password" value={nueva} onChange={(event) => setNueva(event.target.value)} />
              </Field>
              <Field id="crear-repetir" label="Repetir contraseña">
                <input id="crear-repetir" className="notia-login-input" type="password" autoComplete="new-password" value={repetir} onChange={(event) => setRepetir(event.target.value)} />
              </Field>
              <PasswordHint hint={passwordHint(nueva, repetir)} />
            </div>
            <p className="notia-login-text">Sin esta contraseña no se puede abrir la configuración de la biblioteca: no hay forma de recuperarla.</p>
            <div className="notia-login-actions">
              {errorLine}
              <button type="submit" className="notia-login-primary" disabled={!canCreate}>{busy ? 'Guardando…' : 'Guardar contraseña'}</button>
            </div>
          </form>
        ) : null}

        {screen === 'cambiar' ? (
          <form className="notia-login-body" onSubmit={submitCambiar} noValidate>
            <div className="notia-login-heading">
              <BackButton onClick={() => go('login')} />
              <h1>Cambiar contraseña</h1>
              <p>Confirmá la actual y elegí una nueva.</p>
            </div>
            <div className="notia-login-fields">
              <Field id="cambiar-usuario" label="Usuario">
                <input id="cambiar-usuario" className="notia-login-input" type="text" autoComplete="username" value={usuario} onChange={(event) => setUsuario(event.target.value)} />
              </Field>
              <Field id="cambiar-actual" label="Contraseña actual">
                <input id="cambiar-actual" className="notia-login-input" type="password" autoComplete="current-password" value={actual} onChange={(event) => setActual(event.target.value)} />
              </Field>
              <Field id="cambiar-nueva" label="Nueva contraseña">
                <input id="cambiar-nueva" className="notia-login-input" type="password" autoComplete="new-password" value={nueva} onChange={(event) => setNueva(event.target.value)} />
              </Field>
              <Field id="cambiar-repetir" label="Repetir nueva contraseña">
                <input id="cambiar-repetir" className="notia-login-input" type="password" autoComplete="new-password" value={repetir} onChange={(event) => setRepetir(event.target.value)} />
              </Field>
              <PasswordHint hint={passwordHint(nueva, repetir, actual)} />
            </div>
            <div className="notia-login-actions">
              {errorLine}
              <button type="submit" className="notia-login-primary" disabled={!canChange}>{busy ? 'Guardando…' : 'Guardar nueva contraseña'}</button>
            </div>
          </form>
        ) : null}
      </main>
    </div>
  )
}

function PasswordHint({ hint }: { hint: Hint }) {
  return <p className="notia-login-hint" data-tone={hint.tone} aria-live="polite">{hint.text}</p>
}
