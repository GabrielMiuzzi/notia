import { useEffect, useRef, useState, type ReactNode } from 'react'
import { FileText, Folder, Globe, Link2, ListChecks, LogOut, Moon, PanelLeft, Sparkles, Sun, Waypoints } from 'lucide-react'
import type { TaskManagerPublicationStatus } from '../../services/taskManagerPublicationClient'
import '../../styles/publishedTopBar.css'

/** What the page shows now, as the last step of the path. */
export type PublishedLocation =
  | { kind: 'tasks' }
  | { kind: 'graph' }
  | { kind: 'note'; title: string }

export type PublicationConnection = TaskManagerPublicationStatus | 'uninitialized'

interface PublishedTopBarProps {
  explorerOpen: boolean
  onToggleExplorer: () => void
  /** Name of the published library as the page shows it. */
  vaultName: string
  location: PublishedLocation
  /** The open notes and tickets, between the path and the actions. */
  tabs: ReactNode
  connection: PublicationConnection
  /** When the page last caught up with the host, in ms. */
  lastSyncAt: number | null
  onSync: () => void
  onCopyLink: () => void
  chatOpen: boolean
  onToggleChat: () => void
  theme: 'dark' | 'light'
  onToggleTheme: () => void
  userName: string
  userRole: string
  onLogout: () => void
}

const SYNC_REFRESH_MS = 30_000

function syncLabel(connection: PublicationConnection): string {
  switch (connection) {
    case 'connected': return 'Sincronizado'
    case 'syncing': return 'Sincronizando…'
    case 'connecting': return 'Conectando…'
    case 'uninitialized': return 'Preparando conexión…'
    case 'paused': return 'En pausa'
    case 'offline': return 'Sin conexión'
    case 'conflict': return 'Conflicto'
    case 'revoked': return 'Acceso revocado'
    case 'stopped': return 'Publicación detenida'
    case 'reconfigured': return 'Publicación reconfigurada'
    case 'closed': return 'Conexión cerrada'
  }
}

function syncTone(connection: PublicationConnection): 'ok' | 'busy' | 'warn' | 'error' {
  if (connection === 'connected') return 'ok'
  if (connection === 'syncing' || connection === 'connecting' || connection === 'uninitialized') return 'busy'
  if (connection === 'paused') return 'warn'
  return 'error'
}

function sinceLabel(lastSyncAt: number | null, now: number): string {
  if (lastSyncAt === null) return ''
  const minutes = Math.floor((now - lastSyncAt) / 60_000)
  return minutes < 1 ? '· recién' : `· hace ${minutes} min`
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  const letters = words.length > 1 ? `${words[0][0]}${words[1][0]}` : (words[0] ?? '?').slice(0, 2)
  return letters.toUpperCase()
}

/** The Notia mark, as the sign-in window draws it. */
function NotiaMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 4h9l5 5v13a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />
      <path d="M17 4v5h5" />
      <path d="M10 15h8M10 19h5" />
    </svg>
  )
}

function LocationIcon({ location }: { location: PublishedLocation }) {
  if (location.kind === 'graph') return <Waypoints size={15} strokeWidth={2} aria-hidden="true" />
  if (location.kind === 'note') return <FileText size={15} strokeWidth={2} aria-hidden="true" />
  return <ListChecks size={15} strokeWidth={2} aria-hidden="true" />
}

function locationLabel(location: PublishedLocation): string {
  if (location.kind === 'graph') return 'Vista de grafo'
  if (location.kind === 'note') return location.title
  return 'Task Manager'
}

/**
 * The top bar of the published page («Web publicada · barra superior» of
 * the Task Manager canvas): the explorer's toggle, the mark and the path on
 * the left; the open documents in the middle; sync, link, assistant, theme
 * and account on the right. Every action is the shell's.
 */
export function PublishedTopBar({
  explorerOpen,
  onToggleExplorer,
  vaultName,
  location,
  tabs,
  connection,
  lastSyncAt,
  onSync,
  onCopyLink,
  chatOpen,
  onToggleChat,
  theme,
  onToggleTheme,
  userName,
  userRole,
  onLogout,
}: PublishedTopBarProps) {
  const [now, setNow] = useState(() => Date.now())
  const [menuOpen, setMenuOpen] = useState(false)
  const accountRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), SYNC_REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [])
  useEffect(() => setNow(Date.now()), [lastSyncAt])

  useEffect(() => {
    if (!menuOpen) return undefined
    const close = (event: PointerEvent) => {
      if (!accountRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', escape)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', escape)
    }
  }, [menuOpen])

  const explorerLabel = explorerOpen ? 'Ocultar explorador' : 'Mostrar explorador'
  const chatLabel = chatOpen ? 'Cerrar asistente' : 'Abrir asistente'
  const tone = syncTone(connection)
  const since = tone === 'ok' ? sinceLabel(lastSyncAt, now) : ''
  const label = syncLabel(connection)
  const terminal = connection === 'revoked' || connection === 'stopped' || connection === 'reconfigured'
  const ThemeIcon = theme === 'dark' ? Sun : Moon

  return (
    <header className="pub-topbar">
      <div className="pub-topbar-start">
        <button
          type="button"
          className={`pub-topbar-icon${explorerOpen ? ' is-on' : ''}`}
          aria-label={explorerLabel}
          aria-pressed={explorerOpen}
          title={explorerLabel}
          onClick={onToggleExplorer}
        >
          <PanelLeft size={18} strokeWidth={1.9} aria-hidden="true" />
        </button>
        <span className="pub-topbar-brand">
          <span className="pub-topbar-mark"><NotiaMark /></span>
          <span className="pub-topbar-brand-name">Notia</span>
        </span>
        <span className="pub-topbar-slash pub-hide-md" aria-hidden="true">/</span>
        <button type="button" className="pub-topbar-crumb pub-hide-lg" title="Ver las carpetas" onClick={onToggleExplorer}>
          <Folder size={15} strokeWidth={1.9} aria-hidden="true" />
          {vaultName}
        </button>
        <span className="pub-topbar-slash pub-hide-lg" aria-hidden="true">/</span>
        <span className="pub-topbar-here pub-hide-sm" aria-current="page">
          <LocationIcon location={location} />
          <span>{locationLabel(location)}</span>
        </span>
      </div>

      <div className="pub-topbar-tabs">{tabs}</div>

      <div className="pub-topbar-end">
        <button
          type="button"
          className={`pub-topbar-sync is-${tone}`}
          title="Sincronizar ahora"
          aria-label={`${label}${since ? ` ${since.replace('· ', '')}` : ''}. Sincronizar ahora`}
          disabled={terminal}
          onClick={onSync}
        >
          {tone === 'busy' ? <span className="pub-topbar-spinner" aria-hidden="true" /> : <span className="pub-topbar-dot" aria-hidden="true" />}
          <span className="pub-topbar-sync-label">{label}</span>
          {since ? <span className="pub-topbar-sync-when pub-hide-lg">{since}</span> : null}
        </button>
        <span className="pub-topbar-published pub-hide-md" title="Lo ven las personas de la biblioteca que entran con su usuario">
          <Globe size={14} strokeWidth={2} aria-hidden="true" />
          Publicado
        </span>
        <span className="pub-topbar-divider" aria-hidden="true" />
        <button type="button" className="pub-topbar-button" aria-label="Copiar enlace" onClick={onCopyLink}>
          <Link2 size={15} strokeWidth={2} aria-hidden="true" />
          <span className="pub-hide-md">Copiar enlace</span>
        </button>
        <button
          type="button"
          className={`pub-topbar-button pub-topbar-assistant${chatOpen ? ' is-on' : ''}`}
          aria-label={chatLabel}
          aria-pressed={chatOpen}
          title={chatLabel}
          onClick={onToggleChat}
        >
          <Sparkles size={16} strokeWidth={2} aria-hidden="true" />
          <span className="pub-hide-md">Asistente</span>
        </button>
        <button type="button" className="pub-topbar-icon pub-topbar-theme" aria-label="Cambiar tema" title="Cambiar tema" onClick={onToggleTheme}>
          <ThemeIcon size={17} strokeWidth={1.9} aria-hidden="true" />
        </button>
        <div className="pub-topbar-account" ref={accountRef}>
          <button
            type="button"
            className="pub-topbar-avatar-button"
            aria-label={`Cuenta de ${userName}`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span className="pub-topbar-avatar">{initials(userName)}</span>
          </button>
          {menuOpen ? (
            <div className="pub-topbar-menu" role="menu" aria-label="Cuenta">
              <span className="pub-topbar-menu-who">
                <span className="pub-topbar-menu-name">{userName}</span>
                <span className="pub-topbar-menu-role">{userRole} de {vaultName}</span>
              </span>
              <button
                type="button"
                role="menuitem"
                className="pub-topbar-menu-item is-danger"
                onClick={() => {
                  setMenuOpen(false)
                  onLogout()
                }}
              >
                <LogOut size={15} strokeWidth={2} aria-hidden="true" />
                Cerrar sesión
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  )
}
