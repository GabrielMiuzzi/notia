import { memo, Suspense, useCallback, useMemo, lazy } from 'react'
import { shallowEqual } from 'react-redux'
import { useAppSelector } from '../../store/hooks'
import { selectIsHeavyWorkspaceView } from '../../features/ui/uiSelectors'
import { selectActiveWorkspaceView, selectActiveDocument, selectSaveStatus, selectTreeNodes } from '../../features/documents/documentsSelectors'
import { selectActiveLibraryName, selectActiveLibrary } from '../../features/library/librarySelectors'
import { selectAiSettings, selectTheme } from '../../features/preferences/preferencesSelectors'
import { useNotiaAction } from '../../context/notiaActions/useNotiaAction'
import { MainView } from './MainView'
import { ChatWorkspaceView } from './views/chat/ChatWorkspaceView'
import { ColdPassView } from './views/ColdPassView'
import { MeetingView } from './views/MeetingView'
import { FinanceView } from './views/FinanceView'
import { buildWikiLinkTargets } from '../../engines/markdown/wikiLinkEngine'
import type { ColdPassEntry } from '../../types/coldpass'
import type { TaskManagerChatContext } from '../../modules/task-manager/types/taskManagerTypes'
import type { LibraryGraphModel } from '../../types/graph/libraryGraph'

const GraphView = lazy(async () => {
  const module = await import('./views/GraphView')
  return { default: module.GraphView }
})
const TaskManagerApp = lazy(async () => {
  const module = await import('../../modules/task-manager/components/TaskManagerApp')
  return { default: module.TaskManagerApp }
})

interface NotiaWorkspaceProps {
  mountedHeavyWorkspaceView: string
  isAndroidRuntime: boolean
  coldPassEntries: ColdPassEntry[]
  coldPassSession: object | null
  activeTaskManagerVault: { path: string; androidTreeUri?: string } | null
  graphModel: LibraryGraphModel
  graphSourcesByPath: Record<string, string>
  isGraphLoading: boolean
  graphChatSelectedPaths: string[]
  setGraphChatSelectedPaths: (paths: string[]) => void
  previousChatFiles: { id: string; filePath: string; title: string }[]
  setTaskManagerActivePanelId: (id: string) => void
  setTaskManagerChatContext: (ctx: TaskManagerChatContext | null) => void
  isImportingVault: boolean
}

function WorkspaceFallback({ label }: { label: string }) {
  return (
    <main className="notia-main" role="status" aria-live="polite">
      <div className="notia-workspace-deferred-view">
        <div className="notia-workspace-deferred-card">
          <strong>{label}</strong>
          <span>Cargando módulo pesado...</span>
        </div>
      </div>
    </main>
  )
}

function NotiaWorkspaceComponent({
  mountedHeavyWorkspaceView,
  isAndroidRuntime,
  coldPassEntries,
  coldPassSession,
  activeTaskManagerVault,
  graphModel,
  graphSourcesByPath,
  isGraphLoading,
  graphChatSelectedPaths,
  setGraphChatSelectedPaths,
  previousChatFiles,
  setTaskManagerActivePanelId,
  setTaskManagerChatContext,
  isImportingVault,
}: NotiaWorkspaceProps) {
  const handleOpenFileFromView = useNotiaAction('openFileFromView')
  const handleChatWorkspaceTreeChanged = useNotiaAction('chatWorkspaceTreeChanged')
  const handleOpenFile = useNotiaAction('openFile')
  const handleOpenColdPassCredentialModal = useNotiaAction('coldPassOpenCredentialModal')
  const handleColdPassImportVault = useNotiaAction('coldPassImportVault')
  const handleColdPassEditCredential = useNotiaAction('coldPassEditCredential')
  const handleColdPassDeleteCredential = useNotiaAction('coldPassDeleteCredential')
  const handleTextDocumentChange = useNotiaAction('textDocumentChange')

  const chatCallbacks = useMemo(() => ({
    onChatCreated: handleChatWorkspaceTreeChanged,
    onChatDeleted: handleChatWorkspaceTreeChanged,
  }), [handleChatWorkspaceTreeChanged])

  const handleTaskManagerPanelChange = useCallback((id: string) => {
    setTaskManagerActivePanelId(id)
  }, [setTaskManagerActivePanelId])

  const handleTaskManagerChatContextChange = useCallback((ctx: TaskManagerChatContext | null) => {
    setTaskManagerChatContext(ctx)
  }, [setTaskManagerChatContext])

  const activeWorkspaceView = useAppSelector(selectActiveWorkspaceView)
  const activeDocument = useAppSelector(selectActiveDocument)
  const saveStatus = useAppSelector(selectSaveStatus)
  const isHeavyWorkspaceView = useAppSelector(selectIsHeavyWorkspaceView)
  const libraryName = useAppSelector(selectActiveLibraryName)
  const treeNodes = useAppSelector(selectTreeNodes)
  const activeLibrary = useAppSelector(selectActiveLibrary)
  const aiPreferences = useAppSelector(selectAiSettings, shallowEqual)
  const appTheme = useAppSelector(selectTheme)
  const isMarkdownDocumentActive = activeDocument?.viewKind === 'markdown'

  const markdownWikiLinkTargets = useMemo(
    () => (isMarkdownDocumentActive ? buildWikiLinkTargets(treeNodes, activeLibrary?.path ?? null) : []),
    [activeLibrary?.path, isMarkdownDocumentActive, treeNodes],
  )

  const shouldDeferHeavyWorkspaceMount =
    isAndroidRuntime
    && isHeavyWorkspaceView
    && mountedHeavyWorkspaceView !== activeWorkspaceView

  if (shouldDeferHeavyWorkspaceMount) {
    return (
      <main className="notia-main">
        <div className="notia-workspace-deferred-view" role="status" aria-live="polite">
          <div className="notia-workspace-deferred-card">
            <strong>
              {activeWorkspaceView === 'graph'
                ? 'Preparando graph view'
                : activeWorkspaceView === 'task-manager'
                  ? 'Preparando Task Manager'
                  : 'Preparando chat'}
            </strong>
            <span>
              {activeWorkspaceView === 'graph'
                ? 'Android muestra primero la vista y completa la carga pesada justo despues.'
                : activeWorkspaceView === 'task-manager'
                  ? 'Android abre primero el modulo y deja la lectura del vault para el siguiente frame.'
                  : 'Android abre primero el espacio y completa la carga del historial a continuacion.'}
            </span>
          </div>
        </div>
      </main>
    )
  }

  if (activeWorkspaceView === 'graph') {
    return (
      <Suspense fallback={<WorkspaceFallback label="Preparando graph view" />}>
        <GraphView
          graphModel={graphModel}
          graphSourcesByPath={graphSourcesByPath}
          libraryName={libraryName}
          isLoading={isGraphLoading}
          onOpenFile={handleOpenFileFromView}
          chatSelectedPaths={graphChatSelectedPaths}
          onChatSelectedPathsChange={setGraphChatSelectedPaths}
        />
      </Suspense>
    )
  }

  if (activeWorkspaceView === 'chat') {
    return (
      <ChatWorkspaceView
        agentScope="library"
        library={activeLibrary}
        aiPreferences={aiPreferences}
        previousChats={previousChatFiles}
        historyHydrationMode={isAndroidRuntime ? 'minimal' : 'full'}
        onChatCreated={chatCallbacks.onChatCreated}
        onChatDeleted={chatCallbacks.onChatDeleted}
      />
    )
  }

  if (activeWorkspaceView === 'task-manager') {
    return (
      <Suspense fallback={<WorkspaceFallback label="Preparando Task Manager" />}>
        <TaskManagerApp
          embedded
          vault={activeTaskManagerVault}
          onOpenTaskFile={handleOpenFile}
          onActivePanelChange={handleTaskManagerPanelChange}
          onActiveChatContextChange={handleTaskManagerChatContextChange}
        />
      </Suspense>
    )
  }

  if (activeWorkspaceView === 'coldpass') {
    return (
      <ColdPassView
        entries={coldPassEntries}
        isUnlocked={Boolean(coldPassSession)}
        isImportingVault={isImportingVault}
        onCreateCredential={handleOpenColdPassCredentialModal}
        onImportVault={handleColdPassImportVault}
        onEditCredential={handleColdPassEditCredential}
        onDeleteCredential={handleColdPassDeleteCredential}
      />
    )
  }

  if (activeWorkspaceView === 'meeting') {
    return <MeetingView />
  }

  if (activeWorkspaceView === 'finance') {
    return <FinanceView library={activeLibrary} aiPreferences={aiPreferences} />
  }

  return (
    <MainView
      activeDocument={activeDocument}
      saveStatus={saveStatus}
      onTextDocumentChange={handleTextDocumentChange}
      markdownWikiLinkTargets={markdownWikiLinkTargets}
      onOpenLinkedFile={handleOpenFileFromView}
      theme={appTheme}
    />
  )
}

export const NotiaWorkspace = memo(NotiaWorkspaceComponent)
NotiaWorkspace.displayName = 'NotiaWorkspace'
