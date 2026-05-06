import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { startPerformanceMeasurement } from './services/runtime/performanceBaseline'
import { notiaLog } from './services/runtime/notiaLogger'

const bootstrapMeasurement = startPerformanceMeasurement('app.bootstrap', {
  stage: 'root-mount',
})

notiaLog('app', 'bootstrap started', { stage: 'root-mount' })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
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
