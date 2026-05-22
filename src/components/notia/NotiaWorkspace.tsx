import { memo, useMemo } from 'react'
import { shallowEqual } from 'react-redux'
import { useAppSelector } from '../../store/hooks'
import { selectIsHeavyWorkspaceView } from '../../features/ui/uiSelectors'
import { selectActiveWorkspaceView, selectActiveDocument, selectSaveStatus, selectTreeNodes } from '../../features/documents/documentsSelectors'
import { selectActiveLibraryName, selectActiveLibrary } from '../../features/library/librarySelectors'
import { selectAiSettings, selectInkdocPreferences } from '../../features/preferences/preferencesSelectors'
import { useNotiaActions } from '../../context/notiaActions/NotiaActionsContext'
import { MainView } from './MainView'
import { GraphView } from './views/GraphView'
import { ChatWorkspaceView } from './views/chat/ChatWorkspaceView'
import { ColdPassView } from './views/ColdPassView'
import { TaskManagerApp, type TaskManagerChatContext } from '../../modules/task-manager/components/TaskManagerApp'
import { buildWikiLinkTargets } from '../../engines/markdown/wikiLinkEngine'
import { collectFilesFromTree } from '../../utils/tree/collectFilesFromTree'
import type { ColdPassEntry } from '../../types/coldpass'

interface NotiaWorkspaceProps {
  mountedHeavyWorkspaceView: string
  isAndroidRuntime: boolean
  coldPassEntries: ColdPassEntry[]
  coldPassSession: object | null
  activeTaskManagerVault: { path: string; androidTreeUri?: string } | null
  graphModel: object
  graphSourcesByPath: Record<string, string>
  isGraphLoading: boolean
  graphChatSelectedPaths: string[]
  setGraphChatSelectedPaths: (paths: string[]) => void
  previousChatFiles: { id: string; filePath: string; title: string }[]
  setTaskManagerActivePanelId: (id: string) => void
  setTaskManagerChatContext: (ctx: TaskManagerChatContext | null) => void
  isImportingVault: boolean
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
  const actions = useNotiaActions()

  const activeWorkspaceView = useAppSelector(selectActiveWorkspaceView)
  const activeDocument = useAppSelector(selectActiveDocument)
  const saveStatus = useAppSelector(selectSaveStatus)
  const isHeavyWorkspaceView = useAppSelector(selectIsHeavyWorkspaceView)
  const libraryName = useAppSelector(selectActiveLibraryName)
  const treeNodes = useAppSelector(selectTreeNodes)
  const activeLibrary = useAppSelector(selectActiveLibrary)
  const aiPreferences = useAppSelector(selectAiSettings, shallowEqual)
  const inkdocPreferences = useAppSelector(selectInkdocPreferences, shallowEqual)
  const isMarkdownDocumentActive = activeDocument?.viewKind === 'markdown'

  const libraryFilePaths = useMemo(() => {
    if (activeWorkspaceView !== 'documents') {
      return []
    }
    return collectFilesFromTree(treeNodes)
  }, [activeWorkspaceView, treeNodes])

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
      <GraphView
        graphModel={graphModel as any}
        graphSourcesByPath={graphSourcesByPath}
        libraryName={libraryName}
        isLoading={isGraphLoading}
        onOpenFile={actions.openFileFromView}
        chatSelectedPaths={graphChatSelectedPaths}
        onChatSelectedPathsChange={setGraphChatSelectedPaths}
      />
    )
  }

  if (activeWorkspaceView === 'chat') {
    return (
      <ChatWorkspaceView
        library={activeLibrary}
        aiPreferences={aiPreferences}
        previousChats={previousChatFiles}
        historyHydrationMode={isAndroidRuntime ? 'minimal' : 'full'}
        onChatCreated={actions.chatWorkspaceTreeChanged}
        onChatDeleted={actions.chatWorkspaceTreeChanged}
      />
    )
  }

  if (activeWorkspaceView === 'task-manager') {
    return (
      <TaskManagerApp
        embedded
        vault={activeTaskManagerVault}
        onOpenTaskFile={actions.openFile}
        onActivePanelChange={setTaskManagerActivePanelId}
        onActiveChatContextChange={setTaskManagerChatContext}
      />
    )
  }

  if (activeWorkspaceView === 'coldpass') {
    return (
      <ColdPassView
        entries={coldPassEntries}
        isUnlocked={Boolean(coldPassSession)}
        isImportingVault={isImportingVault}
        onCreateCredential={actions.coldPassOpenCredentialModal}
        onImportVault={actions.coldPassImportVault}
        onEditCredential={actions.coldPassEditCredential}
        onDeleteCredential={actions.coldPassDeleteCredential}
      />
    )
  }

  return (
    <MainView
      activeDocument={activeDocument}
      saveStatus={saveStatus}
      onTextDocumentChange={actions.textDocumentChange}
      onInkdocDocumentPersist={actions.inkdocDocumentPersist}
      rootPath={activeLibrary?.path ?? null}
      libraryAndroidTreeUri={activeLibrary?.androidTreeUri}
      libraryFilePaths={libraryFilePaths}
      inkdocPreferences={inkdocPreferences}
      aiPreferences={aiPreferences}
      markdownWikiLinkTargets={markdownWikiLinkTargets}
      onOpenLinkedFile={actions.openFileFromView}
    />
  )
}

export const NotiaWorkspace = memo(NotiaWorkspaceComponent)
NotiaWorkspace.displayName = 'NotiaWorkspace'