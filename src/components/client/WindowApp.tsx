import { lazy, Suspense, useEffect, useState } from 'react'
import { fetchConnection, type ConnectionView } from '../../services/connection/connectionRuntime'

const App = lazy(() => import('../../App'))
const ClientApp = lazy(() => import('./ClientApp').then((module) => ({ default: module.ClientApp })))

/**
 * Entry of the app window. A host (or a device with its own library) opens
 * the app; a client first reaches its host. The backend keeps the mode.
 */
export function WindowApp() {
  const [connection, setConnection] = useState<ConnectionView | 'host' | null>(null)

  useEffect(() => {
    let active = true
    fetchConnection()
      .then((view) => { if (active) setConnection(view.mode === 'client' ? view : 'host') })
      // Without an answer the window opens its own library, as before.
      .catch(() => { if (active) setConnection('host') })
    return () => { active = false }
  }, [])

  if (connection === null) return null
  return (
    <Suspense fallback={null}>
      {connection === 'host' ? <App /> : <ClientApp initial={connection} />}
    </Suspense>
  )
}
