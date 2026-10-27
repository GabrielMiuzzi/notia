import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { PublicSpaceApp } from './modules/public-space/components/PublicSpaceApp'
import './modules/public-space/styles/publicSpace.css'

const RELOADED_AT_KEY = 'notia-public-space-reloaded-at'
const RELOAD_PAUSE_MS = 30_000

// A rebuilt site renames its files, and a page opened before cannot load the
// ones it asks for later (the diagram viewer, the formulas, the highlighter).
// One reload gets the current page; a second failure soon after shows the
// code instead of reloading again and again.
window.addEventListener('vite:preloadError', (event) => {
  try {
    const reloadedAt = Number(window.sessionStorage.getItem(RELOADED_AT_KEY) ?? 0)
    if (Date.now() - reloadedAt < RELOAD_PAUSE_MS) return
    window.sessionStorage.setItem(RELOADED_AT_KEY, String(Date.now()))
  } catch {
    return
  }
  event.preventDefault()
  window.location.reload()
})

const root = document.getElementById('root')
if (root) {
  createRoot(root).render(
    <StrictMode>
      <PublicSpaceApp />
    </StrictMode>,
  )
}
