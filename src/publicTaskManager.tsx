import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'
import { ConfirmationEngineProvider } from './context/confirmation/ConfirmationEngine'
import { PublishedTaskManagerShell, type PublishedTaskManagerBootstrap } from './modules/task-manager/components/PublishedTaskManagerShell'
import { initializeTaskManagerPublicationClient } from './modules/task-manager/services/taskManagerPublicationClient'
import { createTaskManagerPublicationTransport } from './modules/task-manager/services/taskManagerPublicationTransport'
import { installBackendTransport } from './services/transport'
import { store } from './store/index'
import './index.css'
import './styles/notia.css'

declare global {
  interface Window {
    __NOTIA_PUBLISHED_TASK_ROOT_AT_VAULT__?: boolean
    __NOTIA_PUBLISHED_TASK_ROOT_FOLDER__?: 'task-mannager' | 'task-manager'
  }
}

const publicationUrl = new URL(window.location.href)
const publicationPath = publicationUrl.pathname.replace(/\/app\/?$/, '').replace(/\/+$/, '')
window.__NOTIA_PUBLISHED_TASK_MANAGER__ = true
installBackendTransport(createTaskManagerPublicationTransport(publicationPath))

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
