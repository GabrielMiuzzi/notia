import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'
import { ConfirmationEngineProvider } from './context/confirmation/ConfirmationEngine'
import { PublishedTaskManagerShell, type PublishedTaskManagerBootstrap } from './modules/task-manager/components/PublishedTaskManagerShell'
import {
  initializeTaskManagerPublicationClient,
  invokePublishedTaskManagerMutation,
  isTaskManagerPublicationMutationCommand,
} from './modules/task-manager/services/taskManagerPublicationClient'
import { store } from './store/index'
import './index.css'
import './styles/notia.css'

declare global {
  interface Window {
    __TAURI_INTERNALS__: {
      invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>
      transformCallback: () => number
      unregisterCallback: () => void
    }
    __NOTIA_PUBLISHED_TASK_ROOT_AT_VAULT__?: boolean
    __NOTIA_PUBLISHED_TASK_ROOT_FOLDER__?: 'task-mannager' | 'task-manager'
  }
}

const publicationUrl = new URL(window.location.href)
const publicationPath = publicationUrl.pathname.replace(/\/app\/?$/, '').replace(/\/+$/, '')
window.__NOTIA_PUBLISHED_TASK_MANAGER__ = true
let publicationSessionInvalid = false
let publicationRateLimitedUntil = 0

window.__TAURI_INTERNALS__ = {
  invoke: async (command, args = {}) => {
    if (isTaskManagerPublicationMutationCommand(command)) {
      return invokePublishedTaskManagerMutation(command, args)
    }
    if (publicationSessionInvalid) {
      throw new Error('La sesión publicada venció. Volvé a iniciar sesión.')
    }
    if (Date.now() < publicationRateLimitedUntil) {
      throw new Error('Hay demasiadas lecturas pendientes. Esperá unos segundos.')
    }
    const response = await fetch(`${publicationPath}/invoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ command, args }),
    })
    const body: unknown = await response.json()
    if (response.status === 401) {
      publicationSessionInvalid = true
      window.location.assign(publicationPath)
      throw new Error('La sesión publicada venció. Volvé a iniciar sesión.')
    }
    if (response.status === 429) {
      const retryAfterSeconds = Number.parseInt(response.headers.get('retry-after') ?? '30', 10)
      publicationRateLimitedUntil = Date.now() + (Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : 30) * 1000
    }
    if (!response.ok || !body || typeof body !== 'object' || !('result' in body)) {
      throw new Error(body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' ? body.error : 'No se pudo ejecutar la operación de Task Manager.')
    }
    return body.result
  },
  transformCallback: () => 0,
  unregisterCallback: () => {},
}

async function bootstrap(): Promise<void> {
  const response = await fetch(`${publicationPath}/bootstrap`, { cache: 'no-store' })
  if (!response.ok) throw new Error('La publicación no está disponible.')
  const bootstrapData = await response.json() as PublishedTaskManagerBootstrap
  window.__NOTIA_PUBLISHED_TASK_ROOT_AT_VAULT__ = bootstrapData.taskRootAtVault === true
  window.__NOTIA_PUBLISHED_TASK_ROOT_FOLDER__ = bootstrapData.taskRootFolder === 'task-manager'
    ? 'task-manager'
    : 'task-mannager'
  window.localStorage.setItem('task-manager:settings:v1', JSON.stringify(bootstrapData.settings))
  initializeTaskManagerPublicationClient(publicationPath, {
    publicationEpoch: bootstrapData.publicationEpoch,
    revision: bootstrapData.revision,
    sequence: bootstrapData.sequence,
    settings: bootstrapData.settings,
  })
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <Provider store={store}>
        <ConfirmationEngineProvider>
          <PublishedTaskManagerShell bootstrapData={bootstrapData} />
        </ConfirmationEngineProvider>
      </Provider>
    </StrictMode>,
  )
}

void bootstrap().catch((error: unknown) => {
  document.body.textContent = error instanceof Error ? error.message : 'No se pudo cargar Task Manager.'
})
