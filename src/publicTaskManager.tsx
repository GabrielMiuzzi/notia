import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'
import { ConfirmationEngineProvider } from './context/confirmation/ConfirmationEngine'
import { PublishedTaskManagerShell, type PublishedTaskManagerBootstrap } from './modules/task-manager/components/PublishedTaskManagerShell'
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
  }
}

const publicationUrl = new URL(window.location.href)
const publicationPath = publicationUrl.pathname.replace(/\/app\/?$/, '').replace(/\/+$/, '')
window.__NOTIA_PUBLISHED_TASK_MANAGER__ = true

window.__TAURI_INTERNALS__ = {
  invoke: async (command, args = {}) => {
    const response = await fetch(`${publicationPath}/invoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ command, args }),
    })
    const body: unknown = await response.json()
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
  window.localStorage.setItem('task-manager:settings:v1', JSON.stringify(bootstrapData.settings))
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
