import { useEffect, useState } from 'react'
import { Bot, PanelRightClose, PanelRightOpen } from 'lucide-react'
import type { TaskManagerChatContext, TaskManagerSettings } from '../types/taskManagerTypes'
import { PublishedTaskManagerChat } from './PublishedTaskManagerChat'
import { TaskManagerApp } from './TaskManagerApp'
import {
  getTaskManagerPublicationStatus,
  subscribeTaskManagerPublicationStatus,
  type TaskManagerPublicationStatus,
} from '../services/taskManagerPublicationClient'

export interface PublishedTaskManagerBootstrap {
  vaultPath: string
  taskRootAtVault?: boolean
  taskRootFolder?: 'task-mannager' | 'task-manager'
  theme: 'dark' | 'light'
  publicationEpoch: string
  revision: number
  sequence: number
  settings: TaskManagerSettings
}

export function PublishedTaskManagerShell({ bootstrapData }: { bootstrapData: PublishedTaskManagerBootstrap }) {
  const [isChatOpen, setIsChatOpen] = useState(false)
  const [chatContext, setChatContext] = useState<TaskManagerChatContext | null>(null)
  const [connectionStatus, setConnectionStatus] = useState<TaskManagerPublicationStatus | 'uninitialized'>(() => getTaskManagerPublicationStatus())
  const RightPanelIcon = isChatOpen ? PanelRightClose : PanelRightOpen
  useEffect(() => subscribeTaskManagerPublicationStatus(setConnectionStatus), [])

  const statusLabel = resolvePublicationStatusLabel(connectionStatus)
  const isTerminal = connectionStatus === 'revoked' || connectionStatus === 'stopped' || connectionStatus === 'reconfigured'

  return (
    <div className={`notia-app-shell notia-theme-${bootstrapData.theme} notia-published-task-manager`}>
      <header className="notia-titlebar notia-published-titlebar">
        <div className="notia-published-titlebar-label"><Bot size={17} aria-hidden="true" /><strong>Notia</strong><span>Task Manager publicado</span><span className={`notia-publication-status notia-publication-status--${connectionStatus}`} role="status" aria-live="polite">{statusLabel}</span></div>
        <button type="button" className={`notia-titlebar-button notia-published-chat-toggle${isChatOpen ? ' notia-titlebar-button--active' : ''}`} onClick={() => setIsChatOpen((current) => !current)} aria-label={isChatOpen ? 'Cerrar chat de IA' : 'Abrir chat de IA'} aria-expanded={isChatOpen} title={isChatOpen ? 'Cerrar chat de IA' : 'Abrir chat de IA'}>
          <RightPanelIcon size={17} />
        </button>
      </header>
      {isTerminal ? <div className="notia-publication-terminal" role="alert"><span>{statusLabel}. Volvé a iniciar sesión para solicitar acceso nuevamente.</span><button type="button" onClick={() => window.location.assign(window.location.pathname.replace(/\/app\/?$/, '') || '/')}>Volver a iniciar sesión</button></div> : null}
      <div className="notia-workspace notia-published-workspace">
        <div className="notia-published-task-content">
          <TaskManagerApp embedded vault={{ path: bootstrapData.vaultPath }} publishedBoardNames={bootstrapData.settings.boards.map((board) => board.name)} canManageBoards={false} onPublishedChatContextChange={setChatContext} />
        </div>
        <aside className={`notia-right-panel ${isChatOpen ? 'notia-right-panel--open' : 'notia-right-panel--closed'}`} aria-hidden={!isChatOpen}>
          {isChatOpen ? <PublishedTaskManagerChat scopePaths={chatContext?.filePaths ?? []} /> : null}
        </aside>
      </div>
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
