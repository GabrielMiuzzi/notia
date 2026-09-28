import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useAppSelector } from '../../../store/hooks'
import { selectTheme } from '../../../features/preferences/preferencesSelectors'
import { selectSelectedLibraryId } from '../../../features/library/librarySelectors'
import { useLibraryCatalogPersistence } from '../hooks/useLibraryCatalogPersistence'
import { hasHostWindow } from '../../../services/window/windowRuntime'
import {
  APP_AUTH_CHANGED_EVENT,
  fetchAppAuthStatus,
  type AppAuthStatus,
} from '../../../services/auth/appAuthRuntime'
import { LoginScreen } from './LoginScreen'

/**
 * Shows the Owner's sign-in window while the selected library is locked
 * (its configuration is encrypted with the Owner's password) and the app
 * once it is open. The catalog is loaded and saved here, so switching to a
 * locked library keeps the selection while the app is not shown.
 */
export function AppAuthGate({ children }: { children: ReactNode }) {
  useLibraryCatalogPersistence()
  const catalogLoaded = useAppSelector((state) => state.library.catalogLoaded)
  const selectedLibraryId = useAppSelector(selectSelectedLibraryId)
  const theme = useAppSelector(selectTheme)
  const [status, setStatus] = useState<AppAuthStatus | null>(null)
  const [checkError, setCheckError] = useState<string | null>(null)

  const check = useCallback(async (libraryId: string | null) => {
    try {
      setStatus(await fetchAppAuthStatus(libraryId))
      setCheckError(null)
    } catch {
      setCheckError('No se pudo revisar el inicio de sesión de la biblioteca.')
    }
  }, [])

  useEffect(() => {
    if (!catalogLoaded) return
    void check(selectedLibraryId)
  }, [catalogLoaded, check, selectedLibraryId])

  useEffect(() => {
    const handle = () => { void check(selectedLibraryId) }
    window.addEventListener(APP_AUTH_CHANGED_EVENT, handle)
    return () => window.removeEventListener(APP_AUTH_CHANGED_EVENT, handle)
  }, [check, selectedLibraryId])

  const shellClass = `notia-app-shell ${theme === 'dark' ? 'notia-theme-dark' : 'notia-theme-light'}`
  // A status of another library than the selected one is being checked
  // again; meanwhile an open app stays mounted (its tabs are kept).
  const stale = Boolean(status && selectedLibraryId !== null && status.libraryId !== selectedLibraryId)

  if (status && !stale && (status.state === 'locked' || status.state === 'setup') && status.libraryId) {
    return (
      <div className={shellClass}>
        <LoginScreen
          key={status.libraryId}
          status={{ ...status, libraryId: status.libraryId }}
          canRemember={hasHostWindow()}
          onUnlocked={setStatus}
        />
      </div>
    )
  }
  if (status && (status.state === 'unlocked' || status.state === 'none')) {
    return <>{children}</>
  }
  return (
    <div className={shellClass}>
      <div className="notia-login-screen">
        <p className="notia-login-text" role={checkError ? 'alert' : 'status'}>{checkError ?? 'Abriendo Notia…'}</p>
      </div>
    </div>
  )
}
