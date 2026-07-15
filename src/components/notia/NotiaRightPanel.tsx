import { memo, useMemo } from 'react'
import { shallowEqual } from 'react-redux'
import { useAppSelector } from '../../store/hooks'
import { selectIsRightChatPanelOpen, selectIsRightPanelChatMounted } from '../../features/ui/uiSelectors'
import { selectActiveLibrary } from '../../features/library/librarySelectors'
import { selectAiSettings } from '../../features/preferences/preferencesSelectors'
import { useNotiaAction } from '../../context/notiaActions/useNotiaAction'
import { ChatWorkspaceView } from './views/chat/ChatWorkspaceView'
import type { ChatFileContextMode } from '../../services/chat/chatAttachmentRuntime'

interface NotiaRightPanelProps {
  previousChats: { id: string; filePath: string; title: string }[]
  rightPanelChatContextKey: string
  rightPanelChatContextLabel: string
  rightPanelPreferredContextPaths: string[]
  rightPanelPreferredContextName: string | null
  rightPanelPreferredContextMode: ChatFileContextMode | null
  rightPanelPreferredContextScopeKey: string | null
  rightPanelTransientContextPaths: string[]
  rightPanelTransientContextMode: ChatFileContextMode | null
  rightPanelTransientContextSummary: string | null
  isAndroidRuntime: boolean
}

function NotiaRightPanelComponent({
  previousChats,
  rightPanelChatContextKey,
  rightPanelChatContextLabel,
  rightPanelPreferredContextPaths,
  rightPanelPreferredContextName,
  rightPanelPreferredContextMode,
  rightPanelPreferredContextScopeKey,
  rightPanelTransientContextPaths,
  rightPanelTransientContextMode,
  rightPanelTransientContextSummary,
  isAndroidRuntime,
}: NotiaRightPanelProps) {
  const handleChatWorkspaceTreeChanged = useNotiaAction('chatWorkspaceTreeChanged')
  const isRightChatPanelOpen = useAppSelector(selectIsRightChatPanelOpen)
  const isRightPanelChatMounted = useAppSelector(selectIsRightPanelChatMounted)
  const activeLibrary = useAppSelector(selectActiveLibrary)
  const aiPreferences = useAppSelector(selectAiSettings, shallowEqual)

  const chatCallbacks = useMemo(() => ({
    onChatCreated: handleChatWorkspaceTreeChanged,
    onChatDeleted: handleChatWorkspaceTreeChanged,
  }), [handleChatWorkspaceTreeChanged])

  return (
    <aside className={`notia-right-panel ${isRightChatPanelOpen ? 'notia-right-panel--open' : 'notia-right-panel--closed'}`}>
      {isRightChatPanelOpen ? (
        isRightPanelChatMounted ? (
          <ChatWorkspaceView
            key={rightPanelChatContextKey}
            library={activeLibrary}
            aiPreferences={aiPreferences}
            previousChats={previousChats}
            title="Chat lateral"
            description="Acceso rapido a la IA desde el panel derecho."
            showHistoryPanel={false}
            composerContextLabel={rightPanelChatContextLabel}
            preferredContextPaths={rightPanelPreferredContextPaths}
            preferredContextName={rightPanelPreferredContextName}
            preferredContextMode={rightPanelPreferredContextMode}
            preferredContextScopeKey={rightPanelPreferredContextScopeKey}
            transientContextPaths={rightPanelTransientContextPaths}
            transientContextMode={rightPanelTransientContextMode}
            transientContextSummary={rightPanelTransientContextSummary}
            persistTransientContext={false}
            selectMatchingChatOnly
            historyHydrationMode={isAndroidRuntime ? 'minimal' : 'full'}
            onChatCreated={chatCallbacks.onChatCreated}
            onChatDeleted={chatCallbacks.onChatDeleted}
          />
        ) : (
          <main className="notia-main">
            <div className="notia-workspace-deferred-view notia-workspace-deferred-view--panel" role="status" aria-live="polite">
              <div className="notia-workspace-deferred-card">
                <strong>Preparando chat lateral</strong>
                <span>Android abre primero el panel y carga el chat en el siguiente frame.</span>
              </div>
            </div>
          </main>
        )
      ) : null}
    </aside>
  )
}

export const NotiaRightPanel = memo(NotiaRightPanelComponent)
NotiaRightPanel.displayName = 'NotiaRightPanel'