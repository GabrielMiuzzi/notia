import { useCallback, useState } from 'react'
import { File as FileIcon, FilePlus } from 'lucide-react'
import type { NotiaLibrary } from '../../../../types/notia'
import type { HomeFolder, HomeRecentItem } from '../../../../services/home/homeTypes'
import type { ChatAgentOption } from '../../../../services/chat/chatAgentsRuntime'
import { requestChatPanel, type ChatPanelRequest } from '../../../../services/chat/chatComposerRequests'
import { useAppDispatch, useAppSelector } from '../../../../store/hooks'
import { setRightChatPanelOpen, setSidebarOpen } from '../../../../features/ui/uiSlice'
import { selectTreeNodes } from '../../../../features/documents/documentsSelectors'
import { useNotiaAction } from '../../../../context/notiaActions/useNotiaAction'
import { useNarrowContainer } from '../../../../hooks/useNarrowContainer'
import { useHomeDashboard } from './useHomeDashboard'
import { useHomeWeather } from './useHomeWeather'
import { HomeWeatherChip } from './HomeWeatherChip'
import { HomeWeatherCard } from './HomeWeatherCard'
import { HomeAskBox } from './HomeAskBox'
import { HomeRecordButton } from './HomeRecordButton'
import { backendSupports } from '../../../../services/transport'
import { HomeAgendaCard } from './HomeAgendaCard'
import { HomeTasksCard } from './HomeTasksCard'
import { HomeFinanceCard } from './HomeFinanceCard'
import { HomeRoutineCard } from './HomeRoutineCard'
import { HomeNotesCard } from './HomeNotesCard'
import { HomeRecentCard } from './HomeRecentCard'
import './home.css'

/**
 * Width of the view below which Home follows the phone board of the canvas.
 * It replaces the old one-column layout, which started at 640 px.
 */
const PHONE_MAX_WIDTH = 641

/**
 * Home: the library at a glance, from the data of every module. Rust builds
 * the dashboard; each card sends its changes to the module that owns them
 * and the dashboard is read again. In the space of a phone (the view's own
 * width, not the window's) it follows the canvas's phone board.
 */
export function HomeDashboardView({ library }: { library: NotiaLibrary }) {
  const dispatch = useAppDispatch()
  const treeNodes = useAppSelector(selectTreeNodes)
  const railActionClick = useNotiaAction('railActionClick')
  const openFile = useNotiaAction('openFile')
  const explorerToolClick = useNotiaAction('explorerToolClick')
  const toggleFolder = useNotiaAction('toggleFolder')
  const { dashboard, error, isLoading, reload } = useHomeDashboard(library.id)
  const weather = useHomeWeather(library.id)
  const [sentLabel, setSentLabel] = useState<string | null>(null)
  const [root, setRoot] = useState<HTMLElement | null>(null)
  const phone = useNarrowContainer(root, PHONE_MAX_WIDTH)

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

  const viewClass = `notia-main home-view${phone ? ' home-view--phone' : ''}`

  if (!dashboard) {
    return (
      <main ref={setRoot} className={viewClass}>
        <div className="home-status" role={error ? 'alert' : 'status'}>
          <p>{error ?? 'Armando el inicio…'}</p>
          {error ? <button type="button" className="home-button" disabled={isLoading} onClick={() => void reload()}>Reintentar</button> : null}
        </div>
      </main>
    )
  }

  const canRecord = backendSupports('start_speech_session')
  const openMeeting = () => railActionClick('meeting')
  const refreshError = error ? <p className="home-card__error home-refresh-error" role="alert">{error}</p> : null
  const agenda = <HomeAgendaCard card={dashboard.agenda} onOpenAgenda={() => railActionClick('agenda')} phone={phone} />
  const tasks = (
    <HomeTasksCard
      card={dashboard.tasks}
      library={library}
      onOpenBoard={() => railActionClick('task-manager')}
      onOpenTask={(path) => void openFile(path)}
      phone={phone}
    />
  )
  const finance = (
    <HomeFinanceCard
      card={dashboard.finance}
      onOpenFinance={() => railActionClick('finance')}
      onOpenChat={(prompt) => openChatPanel({ kind: 'compose', text: prompt })}
    />
  )
  const routine = <HomeRoutineCard card={dashboard.routine} library={library} onOpenRoutine={() => railActionClick('routine')} onChanged={reload} phone={phone} />
  const notes = <HomeNotesCard card={dashboard.notes} library={library} onChanged={reload} />
  const recent = (
    <HomeRecentCard
      recent={dashboard.recent}
      onOpenHistory={() => railActionClick('chat')}
      onOpenItem={openRecentItem}
      onOpenFolder={openFolder}
      phone={phone}
    />
  )

  if (phone) {
    // The board's status bar, theme switch and bottom navigation belong to the
    // device and the app shell, not to Home.
    return (
      <main ref={setRoot} className={viewClass}>
        <div className="home-phone">
          <header className="home-phone__header">
            <p className="home-eyebrow home-mono">{dashboard.todayLabel}</p>
            <h1>{dashboard.greeting}</h1>
          </header>
          <HomeWeatherCard weather={weather.weather} error={weather.error} isLoading={weather.isLoading} onRetry={() => void weather.reload()} />
          {dashboard.summary ? <p className="home-summary">{dashboard.summary}</p> : null}
          <div className="home-phone__ask">
            <HomeAskBox library={library} onSend={sendToAssistant} phone />
            {sentLabel ? <p className="home-phone__sent" role="status">{sentLabel}</p> : null}
          </div>
          <div className="home-phone__actions">
            <button type="button" className="home-button home-button--phone" onClick={() => explorerToolClick('new-note')}>
              <FileIcon size={16} strokeWidth={1.75} aria-hidden="true" />
              Nueva nota
            </button>
            {canRecord ? <HomeRecordButton onOpenMeeting={openMeeting} phone /> : null}
          </div>
          {refreshError}
          {agenda}
          {tasks}
          {routine}
          {notes}
          {finance}
          {recent}
        </div>
      </main>
    )
  }

  return (
    <main ref={setRoot} className={viewClass}>
      <div className="home-wrap">
        <header className="home-header">
          <div className="home-header__intro">
            <p className="home-eyebrow home-mono">{dashboard.dateLabel}</p>
            <div className="home-header__title">
              <h1>{dashboard.greeting}</h1>
              <HomeWeatherChip weather={weather.weather} error={weather.error} isLoading={weather.isLoading} onRetry={() => void weather.reload()} />
            </div>
            {dashboard.summary ? <p className="home-summary">{dashboard.summary}</p> : null}
          </div>
          <div className="home-header__actions">
            <HomeAskBox library={library} onSend={sendToAssistant} />
            <div className="home-header__buttons">
              <button type="button" className="home-button home-button--tall" onClick={() => explorerToolClick('new-note')}>
                <FilePlus size={15} strokeWidth={1.75} aria-hidden="true" />
                Nueva nota
              </button>
              {canRecord ? <HomeRecordButton onOpenMeeting={openMeeting} /> : null}
            </div>
          </div>
        </header>
        {sentLabel ? <p className="home-sent" role="status">{sentLabel}</p> : null}
        {refreshError}

        <div className="home-grid">
          {agenda}
          {tasks}
          {finance}
          {routine}
          {notes}
          {recent}
        </div>
      </div>
    </main>
  )
}
