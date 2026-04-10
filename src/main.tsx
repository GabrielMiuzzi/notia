import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { startPerformanceMeasurement } from './services/runtime/performanceBaseline'

const bootstrapMeasurement = startPerformanceMeasurement('app.bootstrap', {
  stage: 'root-mount',
})

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
  })
})
