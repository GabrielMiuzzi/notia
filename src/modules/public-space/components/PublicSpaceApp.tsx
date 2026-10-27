import { useCallback, useEffect, useState } from 'react'
import { readPage, readSpace, type PublicPage, type PublicSpace } from '../services/publicSpaceClient'
import { PageArticle } from './PageArticle'
import { PageOutline } from './PageOutline'
import { SearchDialog } from './SearchDialog'
import { SpaceSidebar } from './SpaceSidebar'

type Theme = 'light' | 'dark'
const THEME_KEY = 'notia-public-space-theme'

function initialTheme(): Theme {
  try {
    const stored = window.localStorage.getItem(THEME_KEY)
    if (stored === 'light' || stored === 'dark') return stored
  } catch {
    // Storage blocked: follow the system.
  }
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

function jumpTo(id: string): void {
  const target = document.getElementById(decodeURIComponent(id))
  target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

/** Whether a click on a link should stay in the site. */
function internalTarget(event: React.MouseEvent): HTMLAnchorElement | null {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null
  const anchor = (event.target as HTMLElement).closest('a')
  const href = anchor?.getAttribute('href')
  if (!anchor || !href || anchor.target === '_blank' || anchor.hasAttribute('download')) return null
  return href.startsWith('/') && !href.startsWith('/files/') ? anchor : null
}

interface Loaded {
  path: string
  page: PublicPage | null
  error: string | null
}

/** The public site of a space: GitBook's layout over what Notia publishes. */
export function PublicSpaceApp() {
  const [space, setSpace] = useState<PublicSpace | null>(null)
  const [spaceError, setSpaceError] = useState<string | null>(null)
  const [path, setPath] = useState(() => window.location.pathname)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [theme, setTheme] = useState<Theme>(initialTheme)
  const [menuOpen, setMenuOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    readSpace(controller.signal)
      .then(setSpace)
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setSpaceError(error instanceof Error ? error.message : 'El sitio no está disponible.')
      })
    return () => controller.abort()
  }, [])

  const home = space?.home ?? null
  const pagePath = path === '/' ? home : path

  useEffect(() => {
    if (path === '/' && home) window.history.replaceState(null, '', home + window.location.hash)
  }, [path, home])

  useEffect(() => {
    if (!pagePath) return
    const controller = new AbortController()
    readPage(pagePath, controller.signal)
      .then((page) => {
        setLoaded({ path: pagePath, page, error: null })
        const hash = window.location.hash.slice(1)
        window.requestAnimationFrame(() => (hash ? jumpTo(hash) : window.scrollTo({ top: 0 })))
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setLoaded({ path: pagePath, page: null, error: error instanceof Error ? error.message : 'No se pudo abrir la página.' })
      })
    return () => controller.abort()
  }, [pagePath])

  useEffect(() => {
    const onPopState = () => setPath(window.location.pathname)
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const page = loaded?.path === pagePath ? loaded.page : null
  const pageError = loaded?.path === pagePath ? loaded.error : null

  useEffect(() => {
    if (space) document.title = page ? `${page.title} · ${space.name}` : space.name
  }, [page, space])

  const navigate = useCallback((url: string) => {
    const [target, hash] = url.split('#')
    setMenuOpen(false)
    if (!target || target === window.location.pathname) {
      if (hash) {
        window.history.pushState(null, '', `#${hash}`)
        jumpTo(hash)
      }
      return
    }
    window.history.pushState(null, '', url)
    setPath(target)
  }, [])

  const toggleTheme = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    try {
      window.localStorage.setItem(THEME_KEY, next)
    } catch {
      // The choice lasts for this visit.
    }
  }

  const currentUrl = page?.url ?? pagePath ?? ''

  return (
    <div className="ps-root" data-theme={theme}>
      <a className="ps-skip" href="#ps-content">Saltar al contenido</a>
      <header className="ps-header">
        <button type="button" className="ps-icon-button ps-menu-button" aria-label="Índice" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 4h11M2.5 8h11M2.5 12h11" /></svg>
        </button>
        <a className="ps-brand" href={home ?? '/'} onClick={(event) => { if (home) { event.preventDefault(); navigate(home) } }}>
          <span className="ps-brand-mark" aria-hidden="true">{(space?.name ?? 'N').trim().charAt(0).toUpperCase()}</span>
          <span className="ps-brand-name">{space?.name ?? ''}</span>
        </a>
        <button type="button" className="ps-search-trigger" onClick={() => setSearchOpen(true)} aria-label="Buscar (Ctrl + K)">
          <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5L14 14" /></svg>
          <span className="ps-search-trigger-label">Buscar…</span>
          <kbd>Ctrl K</kbd>
        </button>
        <button type="button" className="ps-icon-button" aria-label={theme === 'dark' ? 'Tema claro' : 'Tema oscuro'} onClick={toggleTheme}>
          {theme === 'dark' ? (
            <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="3" /><path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1" /></svg>
          ) : (
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13 9.5A5.5 5.5 0 016.5 3a5.5 5.5 0 106.5 6.5z" /></svg>
          )}
        </button>
      </header>
      <div className="ps-layout">
        <aside className="ps-sidebar" data-open={menuOpen || undefined} aria-label="Índice del espacio">
          {space ? <SpaceSidebar groups={space.groups} currentUrl={currentUrl} onNavigate={navigate} /> : null}
        </aside>
        {menuOpen ? <div className="ps-scrim" aria-hidden="true" onClick={() => setMenuOpen(false)} /> : null}
        <main
          id="ps-content"
          className="ps-main"
          onClick={(event) => {
            const anchor = internalTarget(event)
            if (!anchor) return
            event.preventDefault()
            navigate(anchor.getAttribute('href') as string)
          }}
        >
          {spaceError ? (
            <div className="ps-state" role="alert"><h1>Sitio no disponible</h1><p>{spaceError}</p></div>
          ) : space && !home ? (
            <div className="ps-state"><h1>{space.name}</h1><p>Este espacio todavía no tiene páginas publicadas.</p></div>
          ) : pageError ? (
            <div className="ps-state" role="alert">
              <h1>Página no encontrada</h1>
              <p>{pageError}</p>
              {home ? <a href={home}>Ir al inicio</a> : null}
            </div>
          ) : page ? (
            <PageArticle page={page} dark={theme === 'dark'} onNavigate={navigate} />
          ) : (
            <div className="ps-loading" role="status" aria-label="Cargando">
              <span /><span /><span />
            </div>
          )}
        </main>
        <aside className="ps-aside">{page ? <PageOutline outline={page.outline} onJump={(id) => { window.history.replaceState(null, '', `#${id}`); jumpTo(id) }} /> : null}</aside>
      </div>
      {searchOpen ? <SearchDialog onClose={() => setSearchOpen(false)} onNavigate={navigate} /> : null}
    </div>
  )
}
