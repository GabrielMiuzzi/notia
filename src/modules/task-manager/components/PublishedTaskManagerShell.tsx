import { useCallback, useEffect, useMemo, useState } from 'react'
import { shallowEqual } from 'react-redux'
import { Bot, FileText, KanbanSquare, PanelRightClose, PanelRightOpen, X } from 'lucide-react'
import type { TaskItem, TaskManagerChatContext, TaskManagerSettings } from '../types/taskManagerTypes'
import { PublishedTaskManagerChat } from './PublishedTaskManagerChat'
import { TaskManagerApp } from './TaskManagerApp'
import { normalizeLibraryContexts } from '../../../services/contexts/libraryContexts'
import { MainView } from '../../../components/notia/MainView'
import { AppDialogModal } from '../../../components/notia/AppDialogModal'
import { NotiaButton } from '../../../components/common/NotiaButton'
import { useAppDispatch, useAppSelector } from '../../../store/hooks'
import { selectDialogState } from '../../../features/documents/documentsSelectors'
import { setDialogState } from '../../../features/documents/documentsSlice'
import type { OpenTextFileDocument } from '../../../types/views/fileDocument'
import type { NotiaLibrary } from '../../../types/notia'
import { usePublishedTicketTabs } from '../hooks/usePublishedTicketTabs'
import {
  getTaskManagerPublicationStatus,
  subscribeTaskManagerPublicationStatus,
  type TaskManagerPublicationStatus,
} from '../services/taskManagerPublicationClient'

export interface PublishedTaskManagerBootstrap {
  libraryId: string
  libraryUserId: string
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
// A link to another note leaves the published boards: nothing opens.
const ignoreLink = () => undefined

export function PublishedTaskManagerShell({ bootstrapData }: { bootstrapData: PublishedTaskManagerBootstrap }) {
  const [isChatOpen, setIsChatOpen] = useState(false)
  const [chatContext, setChatContext] = useState<TaskManagerChatContext | null>(null)
  const [connectionStatus, setConnectionStatus] = useState<TaskManagerPublicationStatus | 'uninitialized'>(() => getTaskManagerPublicationStatus())
  const RightPanelIcon = isChatOpen ? PanelRightClose : PanelRightOpen
  const contexts = useMemo(() => normalizeLibraryContexts(bootstrapData.contexts), [bootstrapData.contexts])
  useEffect(() => subscribeTaskManagerPublicationStatus(setConnectionStatus), [])
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
  const { open: openTicket } = tickets
  const openTask = useCallback((task: TaskItem) => void openTicket(task), [openTicket])
  const publishedBoardNames = useMemo(
    () => bootstrapData.settings.boards.map((board) => board.name),
    [bootstrapData.settings.boards],
  )
  const library = useMemo<NotiaLibrary>(
    () => ({ id: bootstrapData.libraryId, name: 'Task Manager', path: bootstrapData.vaultPath }),
    [bootstrapData.libraryId, bootstrapData.vaultPath],
  )
  const activeDocument = useMemo<OpenTextFileDocument | null>(() => (tickets.activeTab
    ? {
      path: tickets.activeTab.path,
      name: tickets.activeTab.title,
      extension: 'md',
      viewKind: 'markdown',
      source: tickets.activeTab.source,
      lockedContext: tickets.activeTab.lockedContext,
    }
    : null), [tickets.activeTab])

  const statusLabel = resolvePublicationStatusLabel(connectionStatus)
  const isTerminal = connectionStatus === 'revoked' || connectionStatus === 'stopped' || connectionStatus === 'reconfigured'

  return (
    <div className={`notia-app-shell notia-theme-${bootstrapData.theme} notia-published-task-manager`}>
      <header className="notia-titlebar notia-published-titlebar">
        <div className="notia-published-titlebar-label"><Bot size={17} aria-hidden="true" /><strong>Notia</strong><span>Task Manager publicado</span><span className={`notia-publication-status notia-publication-status--${connectionStatus}`} role="status" aria-live="polite">{statusLabel}</span></div>
        {/* As the app's tabs: the open tickets, and the board to go back to (the app reaches it from its rail). */}
        <div className="notia-titlebar-tabs-shell">
          <div className="notia-titlebar-tabs" role="tablist" aria-label="Pestañas">
            <div className={`notia-tab${activeDocument ? '' : ' notia-tab--active'}`} aria-current={activeDocument ? undefined : 'page'}>
              <NotiaButton variant="ghost" className="notia-tab-trigger" title="Task Manager" onClick={() => tickets.activate(null)}>
                <KanbanSquare size={14} strokeWidth={1.75} />
                <span className="notia-tab-title">Task Manager</span>
              </NotiaButton>
            </div>
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
        </div>
        <button type="button" className={`notia-titlebar-button notia-published-chat-toggle${isChatOpen ? ' notia-titlebar-button--active' : ''}`} onClick={() => setIsChatOpen((current) => !current)} aria-label={isChatOpen ? 'Cerrar chat de IA' : 'Abrir chat de IA'} aria-expanded={isChatOpen} title={isChatOpen ? 'Cerrar chat de IA' : 'Abrir chat de IA'}>
          <RightPanelIcon size={17} />
        </button>
      </header>
      {isTerminal ? <div className="notia-publication-terminal" role="alert"><span>{statusLabel}. Volvé a iniciar sesión para solicitar acceso nuevamente.</span><button type="button" onClick={() => window.location.assign(window.location.pathname.replace(/\/app\/?$/, '') || '/')}>Volver a iniciar sesión</button></div> : null}
      <div className="notia-workspace notia-published-workspace">
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
              theme={bootstrapData.theme}
              contexts={contexts}
              activeLibrary={library}
            />
          ) : (
            <TaskManagerApp embedded vault={{ path: bootstrapData.vaultPath, libraryId: bootstrapData.libraryId, libraryUserId: bootstrapData.libraryUserId }} publishedBoardNames={publishedBoardNames} canManageBoards={false} contexts={contexts} onOpenTask={openTask} onPublishedChatContextChange={setChatContext} />
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
