import { StrictMode, lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { startPerformanceMeasurement } from './services/runtime/performanceBaseline'
import { notiaLog } from './services/runtime/notiaLogger'
import { hasHostWindow } from './services/window/windowRuntime'

// The app window talks to its own backend; a browser reaches a headless
// Notia server and first signs in. Each path loads only its entry.
const App = lazy(() => import('./App.tsx'))
const RemoteApp = lazy(() => import('./components/remote/RemoteApp').then((module) => ({ default: module.RemoteApp })))

const bootstrapMeasurement = startPerformanceMeasurement('app.bootstrap', {
  stage: 'root-mount',
})

notiaLog('app', 'bootstrap started', { stage: 'root-mount' })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={null}>
      {hasHostWindow() ? <App /> : <RemoteApp />}
    </Suspense>
  </StrictMode>,
)

window.requestAnimationFrame(() => {
  window.requestAnimationFrame(() => {
    bootstrapMeasurement.success({
      stage: 'post-paint',
    })
    notiaLog('app', 'bootstrap completed', { stage: 'post-paint' })
  })
})
