import { useMemo, useState } from 'react'
import { Bot, PanelRightClose, PanelRightOpen } from 'lucide-react'
import type { AiPreferences } from '../../../services/preferences/aiSettingsStorage'
import type { TaskManagerChatContext, TaskManagerSettings } from '../types/taskManagerTypes'
import { PublishedTaskManagerChat } from './PublishedTaskManagerChat'
import { TaskManagerApp } from './TaskManagerApp'

export interface PublishedTaskManagerBootstrap {
  vaultPath: string
  theme: 'dark' | 'light'
  settings: TaskManagerSettings
  aiPreferences: AiPreferences
}

export function PublishedTaskManagerShell({ bootstrapData }: { bootstrapData: PublishedTaskManagerBootstrap }) {
  const [isChatOpen, setIsChatOpen] = useState(false)
  const [chatContext, setChatContext] = useState<TaskManagerChatContext | null>(null)
  const library = useMemo(() => ({
    id: `published:${bootstrapData.vaultPath}`,
    name: 'Tableros publicados',
    path: bootstrapData.vaultPath,
  }), [bootstrapData.vaultPath])
  const RightPanelIcon = isChatOpen ? PanelRightClose : PanelRightOpen

  return (
    <div className={`notia-app-shell notia-theme-${bootstrapData.theme} notia-published-task-manager`}>
      <header className="notia-titlebar notia-published-titlebar">
        <div className="notia-published-titlebar-label"><Bot size={17} aria-hidden="true" /><strong>Notia</strong><span>Task Manager publicado</span></div>
        <button type="button" className={`notia-titlebar-button notia-published-chat-toggle${isChatOpen ? ' notia-titlebar-button--active' : ''}`} onClick={() => setIsChatOpen((current) => !current)} aria-label={isChatOpen ? 'Cerrar chat de IA' : 'Abrir chat de IA'} aria-expanded={isChatOpen} title={isChatOpen ? 'Cerrar chat de IA' : 'Abrir chat de IA'}>
          <RightPanelIcon size={17} />
        </button>
      </header>
      <div className="notia-workspace notia-published-workspace">
        <div className="notia-published-task-content">
          <TaskManagerApp embedded vault={{ path: bootstrapData.vaultPath }} publishedBoardNames={bootstrapData.settings.boards.map((board) => board.name)} canManageBoards={false} onPublishedChatContextChange={setChatContext} />
        </div>
        <aside className={`notia-right-panel ${isChatOpen ? 'notia-right-panel--open' : 'notia-right-panel--closed'}`} aria-hidden={!isChatOpen}>
          {isChatOpen ? <PublishedTaskManagerChat aiPreferences={bootstrapData.aiPreferences} library={library} scopePaths={chatContext?.filePaths ?? []} /> : null}
        </aside>
      </div>
    </div>
  )
}
