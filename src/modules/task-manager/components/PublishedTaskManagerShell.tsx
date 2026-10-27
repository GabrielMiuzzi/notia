import { useCallback, useEffect, useMemo, useState } from 'react'
import { shallowEqual } from 'react-redux'
import { FileText, X } from 'lucide-react'
import type { TaskItem, TaskManagerChatContext, TaskManagerSettings } from '../types/taskManagerTypes'
import { PublishedTaskManagerChat } from './PublishedTaskManagerChat'
import { TaskManagerApp } from './TaskManagerApp'
import { PublishedExplorer } from './published/PublishedExplorer'
import { PublishedGraph } from './published/PublishedGraph'
import { PublishedRail, type PublishedView } from './published/PublishedRail'
import { PublishedTopBar, type PublishedLocation } from './published/PublishedTopBar'
import { DEFAULT_CONTEXT_TAG, normalizeLibraryContexts } from '../../../services/contexts/libraryContexts'
import { MainView } from '../../../components/notia/MainView'
import { AppDialogModal } from '../../../components/notia/AppDialogModal'
import { NotiaButton } from '../../../components/common/NotiaButton'
import { useAppDispatch, useAppSelector } from '../../../store/hooks'
import { selectDialogState } from '../../../features/documents/documentsSelectors'
import { setDialogState } from '../../../features/documents/documentsSlice'
import type { OpenTextFileDocument } from '../../../types/views/fileDocument'
import type { NotiaLibrary } from '../../../types/notia'
import { publishedVisiblePath, usePublishedTicketTabs } from '../hooks/usePublishedTicketTabs'
import {
  getTaskManagerPublicationStatus,
  requestTaskManagerPublicationResync,
  subscribeTaskManagerPublicationChanges,
  subscribeTaskManagerPublicationStatus,
  type TaskManagerPublicationStatus,
} from '../services/taskManagerPublicationClient'

export interface PublishedTaskManagerBootstrap {
  libraryId: string
  libraryUserId: string
  /** Name and role of the person signed in, for the account menu. */
  userName?: string
  userRole?: string
  vaultPath: string
  taskRootAtVault?: boolean
  taskRootFolder?: 'task-mannager' | 'task-manager'
  theme: 'dark' | 'light'
  publicationEpoch: string
  revision: number
  sequence: number
  settings: TaskManagerSettings
  /** Reads the publication allows (`PUBLISHED_COMMANDS` in Rust). */
  commands?: string[]
  /** The library's contexts, as the app's board and ticket dialogs offer them. */
  contexts?: unknown
  /** The host's page and pen preferences: tickets open on the same sheet. */
  editorPreferences?: unknown
}

const NO_LINK_TARGETS: never[] = []
const ignoreSelection = () => undefined
// Links between notes are not resolved in the publication: nothing opens.
const ignoreLink = () => undefined
const EXPLORER_STORAGE_KEY = 'task-manager:published-explorer-open'
const THEME_STORAGE_KEY = 'task-manager:published-theme'
const TOAST_MS = 2200

/** The page's theme: the one chosen on this browser, else the host's. */
function loadTheme(hostTheme: 'dark' | 'light'): 'dark' | 'light' {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
    return stored === 'dark' || stored === 'light' ? stored : hostTheme
  } catch {
    return hostTheme
  }
}

/** `/task-manager`: the sign-in and the link to share, without `/app`. */
function publicationBasePath(): string {
  return window.location.pathname.replace(/\/app\/?$/, '') || '/'
}

function loadExplorerOpen(): boolean {
  try {
    return window.localStorage.getItem(EXPLORER_STORAGE_KEY) !== 'closed'
  } catch {
    return true
  }
}

export function PublishedTaskManagerShell({ bootstrapData }: { bootstrapData: PublishedTaskManagerBootstrap }) {
  const [isChatOpen, setIsChatOpen] = useState(false)
  const [chatContext, setChatContext] = useState<TaskManagerChatContext | null>(null)
  const [connectionStatus, setConnectionStatus] = useState<TaskManagerPublicationStatus | 'uninitialized'>(() => getTaskManagerPublicationStatus())
  const [view, setView] = useState<PublishedView>('tasks')
  const [isExplorerOpen, setIsExplorerOpen] = useState(loadExplorerOpen)
  const [activePanel, setActivePanel] = useState<string>(bootstrapData.settings.activeTab)
  const [libraryRevision, setLibraryRevision] = useState(0)
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null)
  const [theme, setTheme] = useState<'dark' | 'light'>(() => loadTheme(bootstrapData.theme))
  const [toast, setToast] = useState<string | null>(null)
  const contexts = useMemo(() => normalizeLibraryContexts(bootstrapData.contexts), [bootstrapData.contexts])
  useEffect(() => subscribeTaskManagerPublicationStatus((status) => {
    setConnectionStatus(status)
    if (status === 'connected') setLastSyncAt(Date.now())
  }), [])
  // The host or another guest changed the library: the graph reads it again.
  useEffect(() => subscribeTaskManagerPublicationChanges((change) => {
    if (change.type === 'changed' || change.type === 'resync-required') setLibraryRevision((current) => current + 1)
    if (change.type === 'changed') setLastSyncAt(Date.now())
  }), [])
  useEffect(() => {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme)
    } catch {
      // Without storage the page opens with the host's theme.
    }
  }, [theme])
  useEffect(() => {
    if (!toast) return undefined
    const timer = window.setTimeout(() => setToast(null), TOAST_MS)
    return () => window.clearTimeout(timer)
  }, [toast])
  useEffect(() => {
    try {
      window.localStorage.setItem(EXPLORER_STORAGE_KEY, isExplorerOpen ? 'open' : 'closed')
    } catch {
      // A browser without storage opens the explorer every time.
    }
  }, [isExplorerOpen])
  const dispatch = useAppDispatch()
  const dialogState = useAppSelector(selectDialogState, shallowEqual)
  const showError = useCallback((message: string) => {
    dispatch(setDialogState({ type: 'info', title: 'No se pudo completar la acción', message }))
  }, [dispatch])
  const ticketContext = useMemo(
    () => ({ libraryId: bootstrapData.libraryId, libraryUserId: bootstrapData.libraryUserId }),
    [bootstrapData.libraryId, bootstrapData.libraryUserId],
  )
  const tickets = usePublishedTicketTabs(ticketContext, showError)
  // Stable props: the Task Manager only renders again when they change.
  const { open: openTicket, openNote, rename: renameTab, drop: dropTab, activate } = tickets
  const openTask = useCallback((task: TaskItem) => void openTicket(task), [openTicket])
  const openNotePath = useCallback((path: string) => void openNote(path), [openNote])
  const bumpLibrary = useCallback(() => setLibraryRevision((current) => current + 1), [])
  const publishedBoardNames = useMemo(
    () => bootstrapData.settings.boards.map((board) => board.name),
    [bootstrapData.settings.boards],
  )
  // A new note takes the context of the board the guest is looking at.
  const newNoteContext = useMemo(() => {
    const boards = bootstrapData.settings.boards
    const active = boards.find((board) => board.name === activePanel) ?? boards[0]
    return active?.contexto ?? DEFAULT_CONTEXT_TAG
  }, [activePanel, bootstrapData.settings.boards])
  const library = useMemo<NotiaLibrary>(
    () => ({ id: bootstrapData.libraryId, name: 'Task Manager', path: bootstrapData.vaultPath }),
    [bootstrapData.libraryId, bootstrapData.vaultPath],
  )
  const activeDocument = useMemo<OpenTextFileDocument | null>(() => (tickets.activeTab
    ? {
      path: tickets.activeTab.kind === 'ticket' ? tickets.activeTab.path : publishedVisiblePath(tickets.activeTab.path),
      name: tickets.activeTab.title,
      extension: 'md',
      viewKind: 'markdown',
      source: tickets.activeTab.source,
      lockedContext: tickets.activeTab.lockedContext,
    }
    : null), [tickets.activeTab])

  const selectView = useCallback((next: PublishedView) => {
    activate(null)
    setView(next)
  }, [activate])

  const statusLabel = resolvePublicationStatusLabel(connectionStatus)
  const isTerminal = connectionStatus === 'revoked' || connectionStatus === 'stopped' || connectionStatus === 'reconfigured'
  const location: PublishedLocation = activeDocument
    ? { kind: 'note', title: activeDocument.name }
    : view === 'graph' ? { kind: 'graph' } : { kind: 'tasks' }

  const sync = useCallback(() => {
    requestTaskManagerPublicationResync()
    bumpLibrary()
  }, [bumpLibrary])
  const copyLink = useCallback(() => {
    const link = `${window.location.origin}${publicationBasePath()}`
    void (navigator.clipboard?.writeText(link) ?? Promise.reject(new Error('clipboard')))
      .then(() => setToast('Enlace copiado'))
      .catch(() => setToast(`No se pudo copiar. El enlace es ${link}`))
  }, [])
  const logout = useCallback(() => {
    const base = publicationBasePath()
    // The page goes to the sign-in whatever the answer: the session is over for it.
    void fetch(`${base}/logout`, { method: 'POST', credentials: 'same-origin' })
      .catch(() => undefined)
      .finally(() => window.location.assign(base))
  }, [])

  return (
    <div className={`notia-app-shell notia-theme-${theme} notia-published-task-manager`}>
      <PublishedTopBar
        explorerOpen={isExplorerOpen}
        onToggleExplorer={() => setIsExplorerOpen((current) => !current)}
        vaultName={bootstrapData.vaultPath}
        location={location}
        connection={connectionStatus}
        lastSyncAt={lastSyncAt}
        onSync={sync}
        onCopyLink={copyLink}
        chatOpen={isChatOpen}
        onToggleChat={() => setIsChatOpen((current) => !current)}
        theme={theme}
        onToggleTheme={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
        userName={bootstrapData.userName || 'Invitado'}
        userRole={bootstrapData.userRole || 'Invitado'}
        onLogout={logout}
        tabs={tickets.tabs.length > 0 ? (
          // The open notes and tickets; the rail's «Tareas» and «Grafo» go back.
          <div className="notia-titlebar-tabs" role="tablist" aria-label="Pestañas">
            {tickets.tabs.map((tab) => {
              const isActive = tab.path === tickets.activeTab?.path
              return (
                <div key={tab.path} className={`notia-tab${isActive ? ' notia-tab--active' : ''}`} aria-current={isActive ? 'page' : undefined}>
                  <NotiaButton variant="ghost" className="notia-tab-trigger" title={tab.title} onClick={() => tickets.activate(tab.path)}>
                    <FileText size={14} strokeWidth={1.75} />
                    <span className="notia-tab-title">{tab.title}</span>
                  </NotiaButton>
                  <NotiaButton
                    size="icon"
                    variant="ghost"
                    className="notia-tab-close"
                    title="Cerrar pestaña"
                    aria-label={`Cerrar ${tab.title}`}
                    onClick={() => void tickets.close(tab.path)}
                  >
                    <X size={12} strokeWidth={2} />
                  </NotiaButton>
                </div>
              )
            })}
          </div>
        ) : null}
      />
      {isTerminal ? <div className="notia-publication-terminal" role="alert"><span>{statusLabel}. Volvé a iniciar sesión para solicitar acceso nuevamente.</span><button type="button" onClick={() => window.location.assign(publicationBasePath())}>Volver a iniciar sesión</button></div> : null}
      <div className="notia-workspace notia-published-workspace">
        <aside className={`notia-sidebar ${isExplorerOpen ? 'notia-sidebar--open' : 'notia-sidebar--closed'}`}>
          <PublishedRail
            activeView={view}
            isExplorerOpen={isExplorerOpen}
            onToggleExplorer={() => setIsExplorerOpen((current) => !current)}
            onSelectView={selectView}
          />
          {isExplorerOpen ? (
            <PublishedExplorer
              libraryId={bootstrapData.libraryId}
              newNoteContext={newNoteContext}
              activeBoard={activePanel}
              onOpenNote={openNotePath}
              onEntryRenamed={renameTab}
              onEntryDeleted={dropTab}
              onLibraryChanged={bumpLibrary}
              onError={showError}
              onHide={() => setIsExplorerOpen(false)}
            />
          ) : null}
        </aside>
        {/* Phones and narrow windows: the explorer floats; a tap outside closes it. */}
        {isExplorerOpen ? <button type="button" className="pub-sidebar-scrim" aria-label="Cerrar explorador" onClick={() => setIsExplorerOpen(false)} /> : null}
        <div className="notia-published-task-content">
          {activeDocument ? (
            <MainView
              key={activeDocument.path}
              activeDocument={activeDocument}
              saveStatus={tickets.activeTab?.saveStatus ?? 'idle'}
              onTextDocumentChange={tickets.change}
              markdownWikiLinkTargets={NO_LINK_TARGETS}
              onOpenLinkedFile={ignoreLink}
              onSelectionChange={ignoreSelection}
              externalSourceUpdate={null}
              theme={theme}
              contexts={contexts}
              activeLibrary={library}
            />
          ) : view === 'graph' ? (
            <PublishedGraph libraryId={bootstrapData.libraryId} libraryName="Task Manager" revision={libraryRevision} onOpenNote={openNotePath} />
          ) : (
            <TaskManagerApp embedded vault={{ path: bootstrapData.vaultPath, libraryId: bootstrapData.libraryId, libraryUserId: bootstrapData.libraryUserId }} publishedBoardNames={publishedBoardNames} canManageBoards={false} contexts={contexts} onOpenTask={openTask} onActivePanelChange={setActivePanel} onPublishedChatContextChange={setChatContext} />
          )}
        </div>
        <aside className={`notia-right-panel ${isChatOpen ? 'notia-right-panel--open' : 'notia-right-panel--closed'}`} aria-hidden={!isChatOpen}>
          {/* Ephemeral: closing the panel ends the conversation. */}
          {isChatOpen ? (
            <PublishedTaskManagerChat
              library={library}
              panelId={chatContext?.scopeKey.replace(/^task-manager:panel:/, '') ?? ''}
              onClose={() => setIsChatOpen(false)}
            />
          ) : null}
        </aside>
      </div>
      {toast ? <div className="pub-toast" role="status">{toast}</div> : null}
      <AppDialogModal
        open={Boolean(dialogState)}
        title={dialogState?.title ?? ''}
        message={dialogState?.message ?? ''}
        confirmLabel="Aceptar"
        onConfirm={() => dispatch(setDialogState(null))}
        onClose={() => dispatch(setDialogState(null))}
      />
    </div>
  )
}

function resolvePublicationStatusLabel(status: TaskManagerPublicationStatus | 'uninitialized'): string {
  switch (status) {
    case 'connected': return 'Sincronizado'
    case 'syncing': return 'Sincronizando…'
    case 'paused': return 'Pausado en segundo plano'
    case 'offline': return 'Sin conexión; reintentando…'
    case 'conflict': return 'Conflicto: revisá el cambio'
    case 'revoked': return 'Acceso revocado'
    case 'stopped': return 'Publicación detenida'
    case 'reconfigured': return 'Publicación reconfigurada'
    case 'closed': return 'Conexión cerrada'
    case 'connecting': return 'Conectando…'
    case 'uninitialized': return 'Preparando conexión…'
  }
}
