import { useCallback, useState } from 'react'
import { FilePlus } from 'lucide-react'
import type { NotiaLibrary } from '../../../../types/notia'
import type { HomeFolder, HomeRecentItem } from '../../../../services/home/homeTypes'
import type { ChatAgentOption } from '../../../../services/chat/chatAgentsRuntime'
import { requestChatPanel, type ChatPanelRequest } from '../../../../services/chat/chatComposerRequests'
import { useAppDispatch, useAppSelector } from '../../../../store/hooks'
import { setRightChatPanelOpen, setSidebarOpen } from '../../../../features/ui/uiSlice'
import { selectTreeNodes } from '../../../../features/documents/documentsSelectors'
import { useNotiaAction } from '../../../../context/notiaActions/useNotiaAction'
import { useHomeDashboard } from './useHomeDashboard'
import { HomeAskBox } from './HomeAskBox'
import { HomeRecordButton } from './HomeRecordButton'
import { HomeAgendaCard } from './HomeAgendaCard'
import { HomeTasksCard } from './HomeTasksCard'
import { HomeFinanceCard } from './HomeFinanceCard'
import { HomeRoutineCard } from './HomeRoutineCard'
import { HomeNotesCard } from './HomeNotesCard'
import { HomeRecentCard } from './HomeRecentCard'
import './home.css'

/**
 * Home: the library at a glance, from the data of every module. Rust builds
 * the dashboard; each card sends its changes to the module that owns them
 * and the dashboard is read again.
 */
export function HomeDashboardView({ library }: { library: NotiaLibrary }) {
  const dispatch = useAppDispatch()
  const treeNodes = useAppSelector(selectTreeNodes)
  const railActionClick = useNotiaAction('railActionClick')
  const openFile = useNotiaAction('openFile')
  const explorerToolClick = useNotiaAction('explorerToolClick')
  const toggleFolder = useNotiaAction('toggleFolder')
  const { dashboard, error, isLoading, reload } = useHomeDashboard(library.id)
  const [sentLabel, setSentLabel] = useState<string | null>(null)

  const openChatPanel = useCallback((request: ChatPanelRequest) => {
    dispatch(setRightChatPanelOpen(true))
    requestChatPanel(request)
  }, [dispatch])

  const sendToAssistant = useCallback((text: string, agent: ChatAgentOption | null) => {
    openChatPanel({ kind: 'send', text, agentFileName: agent?.fileName ?? null })
    setSentLabel(`Enviado al asistente · agente ${agent?.name ?? 'Notia'}`)
  }, [openChatPanel])

  const openRecentItem = (item: HomeRecentItem) => {
    if (item.kind === 'meeting') {
      railActionClick('meeting')
      return
    }
    if (!item.path) return
    if (item.kind === 'chat') {
      openChatPanel({ kind: 'open', filePath: item.path, agentFileName: item.agentFile ?? null })
      return
    }
    void openFile(item.path)
  }

  // The folder opens in the explorer, among the library's root folders.
  const openFolder = (folder: HomeFolder) => {
    dispatch(setSidebarOpen(true))
    const node = treeNodes.find((candidate) => candidate.type === 'folder' && (candidate.path === folder.path || candidate.name === folder.name))
    if (node && !node.expanded) toggleFolder(node.id)
  }

  if (!dashboard) {
    return (
      <main className="notia-main home-view">
        <div className="home-status" role={error ? 'alert' : 'status'}>
          <p>{error ?? 'Armando el inicio…'}</p>
          {error ? <button type="button" className="home-button" disabled={isLoading} onClick={() => void reload()}>Reintentar</button> : null}
        </div>
      </main>
    )
  }

  return (
    <main className="notia-main home-view">
      <div className="home-wrap">
        <header className="home-header">
          <div className="home-header__intro">
            <p className="home-eyebrow home-mono">{dashboard.dateLabel}</p>
            <h1>{dashboard.greeting}</h1>
            {dashboard.summary ? <p className="home-summary">{dashboard.summary}</p> : null}
          </div>
          <div className="home-header__actions">
            <HomeAskBox library={library} onSend={sendToAssistant} />
            <div className="home-header__buttons">
              <button type="button" className="home-button home-button--tall" onClick={() => explorerToolClick('new-note')}>
                <FilePlus size={15} strokeWidth={1.75} aria-hidden="true" />
                Nueva nota
              </button>
              <HomeRecordButton onOpenMeeting={() => railActionClick('meeting')} />
            </div>
          </div>
        </header>
        {sentLabel ? <p className="home-sent" role="status">{sentLabel}</p> : null}
        {error ? <p className="home-card__error home-refresh-error" role="alert">{error}</p> : null}

        <div className="home-grid">
          <HomeAgendaCard card={dashboard.agenda} onOpenAgenda={() => railActionClick('agenda')} />
          <HomeTasksCard
            card={dashboard.tasks}
            library={library}
            onOpenBoard={() => railActionClick('task-manager')}
            onOpenTask={(path) => void openFile(path)}
          />
          <HomeFinanceCard
            card={dashboard.finance}
            onOpenFinance={() => railActionClick('finance')}
            onOpenChat={(prompt) => openChatPanel({ kind: 'compose', text: prompt })}
          />
          <HomeRoutineCard card={dashboard.routine} library={library} onOpenRoutine={() => railActionClick('routine')} onChanged={reload} />
          <HomeNotesCard card={dashboard.notes} library={library} onChanged={reload} />
          <HomeRecentCard
            recent={dashboard.recent}
            onOpenHistory={() => railActionClick('chat')}
            onOpenItem={openRecentItem}
            onOpenFolder={openFolder}
          />
        </div>
      </div>
    </main>
  )
}
