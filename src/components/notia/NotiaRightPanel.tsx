import { memo, useCallback, useEffect, useMemo, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'
import { Sparkles, X } from 'lucide-react'
import { shallowEqual } from 'react-redux'
import { useAppSelector, type RootState } from '../../store/hooks'
import { selectIsRightChatPanelOpen, selectIsRightPanelChatMounted } from '../../features/ui/uiSelectors'
import { selectActiveLibrary } from '../../features/library/librarySelectors'
import { selectActiveDocument } from '../../features/documents/documentsSelectors'
import { selectAiSettings } from '../../features/preferences/preferencesSelectors'
import { useNotiaAction } from '../../context/notiaActions/useNotiaAction'
import { ChatWorkspaceView } from './views/chat/ChatWorkspaceView'
import { PerformanceProfiler } from './PerformanceProfiler'
import { MeetingEphemeralChat } from './views/chat/MeetingEphemeralChat'
import type { ChatFileContextMode } from '../../services/chat/chatAttachmentRuntime'
import type { ChatAgentScope } from '../../services/chat/chatAgentTypes'
import type { MarkdownSelectionContext } from '../../types/views/markdownSelection'
import {
  clampRightPanelWidth,
  loadRightPanelWidth,
  saveRightPanelWidth,
} from '../../services/preferences/rightPanelStorage'
import { shouldSelectMatchingRightPanelChat, type RightPanelChatContextChip } from './hooks/useRightPanelChatContext'

interface NotiaRightPanelProps {
  isMeetingContext: boolean
  agentCorpusPaths: string[]
  agentScope: ChatAgentScope | null
  previousChats: { id: string; filePath: string; title: string }[]
  rightPanelChatContextKey: string
  rightPanelChatContext: RightPanelChatContextChip
  rightPanelPreferredContextPaths: string[]
  rightPanelPreferredContextName: string | null
  rightPanelPreferredContextMode: ChatFileContextMode | null
  rightPanelPreferredContextScopeKey: string | null
  rightPanelTransientContextPaths: string[]
  rightPanelTransientContextMode: ChatFileContextMode | null
  rightPanelTransientContextSummary: string | null
  rightPanelTransientSelectedPaths: string[]
  onRightPanelTransientSelectedPathsChange: (paths: string[]) => void
  markdownSelection: MarkdownSelectionContext | null
  onActiveMarkdownDocumentChanged: (documentPath: string, source: string, revision?: string) => void | Promise<void>
}

/** The open note's text for the side chat; a save or a status change does not draw the panel again. */
function selectActiveMarkdownSource(state: RootState): string | null {
  const activeDocument = selectActiveDocument(state)
  return activeDocument?.viewKind === 'markdown' ? activeDocument.source : null
}

function NotiaRightPanelComponent({
  isMeetingContext,
  agentCorpusPaths,
  agentScope,
  previousChats,
  rightPanelChatContextKey,
  rightPanelChatContext,
  rightPanelPreferredContextPaths,
  rightPanelPreferredContextName,
  rightPanelPreferredContextMode,
  rightPanelPreferredContextScopeKey,
  rightPanelTransientContextPaths,
  rightPanelTransientContextMode,
  rightPanelTransientContextSummary,
  rightPanelTransientSelectedPaths,
  onRightPanelTransientSelectedPathsChange,
  markdownSelection,
  onActiveMarkdownDocumentChanged,
}: NotiaRightPanelProps) {
  const handleChatWorkspaceTreeChanged = useNotiaAction('chatWorkspaceTreeChanged')
  const handleToggleRightPanel = useNotiaAction('toggleRightChatPanel')
  const isRightChatPanelOpen = useAppSelector(selectIsRightChatPanelOpen)
  const isRightPanelChatMounted = useAppSelector(selectIsRightPanelChatMounted)
  const activeLibrary = useAppSelector(selectActiveLibrary)
  const activeMarkdownSource = useAppSelector(selectActiveMarkdownSource)
  const aiPreferences = useAppSelector(selectAiSettings, shallowEqual)
  const [panelWidth, setPanelWidth] = useState(() => loadRightPanelWidth(window.innerWidth))
  const [isResizing, setIsResizing] = useState(false)

  useEffect(() => {
    const handleViewportResize = () => {
      setPanelWidth((currentWidth) => clampRightPanelWidth(currentWidth, window.innerWidth))
    }
    window.addEventListener('resize', handleViewportResize)
    return () => window.removeEventListener('resize', handleViewportResize)
  }, [])

  const updatePanelWidth = (nextWidth: number, persist = false) => {
    const clampedWidth = clampRightPanelWidth(nextWidth, window.innerWidth)
    setPanelWidth(clampedWidth)
    if (persist) {
      saveRightPanelWidth(clampedWidth)
    }
  }

  const handleResizePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    setIsResizing(true)
    event.preventDefault()
  }

  const handleResizePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
      return
    }
    updatePanelWidth(window.innerWidth - event.clientX)
  }

  const handleResizePointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    updatePanelWidth(window.innerWidth - event.clientX, true)
    setIsResizing(false)
  }

  const handleResizeKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
      return
    }
    event.preventDefault()
    updatePanelWidth(panelWidth + (event.key === 'ArrowLeft' ? 16 : -16), true)
  }

  const chatCallbacks = useMemo(() => ({
    onChatCreated: handleChatWorkspaceTreeChanged,
    onChatDeleted: handleChatWorkspaceTreeChanged,
  }), [handleChatWorkspaceTreeChanged])

  const handleTransientContextPathRemove = useCallback((path: string) => {
    onRightPanelTransientSelectedPathsChange(
      rightPanelTransientSelectedPaths.filter((selectedPath) => selectedPath !== path),
    )
  }, [onRightPanelTransientSelectedPathsChange, rightPanelTransientSelectedPaths])

  return (
    <aside
      className={`notia-right-panel ${isRightChatPanelOpen ? 'notia-right-panel--open' : 'notia-right-panel--closed'}${isResizing ? ' is-resizing' : ''}`}
      style={{ '--notia-right-panel-width': `${panelWidth}px` } as CSSProperties}
    >
      {isRightChatPanelOpen ? (
        <div
          className="notia-right-panel-resize-handle"
          role="separator"
          aria-label="Cambiar ancho del panel de chat"
          aria-orientation="vertical"
          aria-valuemin={320}
          aria-valuemax={clampRightPanelWidth(Number.MAX_SAFE_INTEGER, window.innerWidth)}
          aria-valuenow={panelWidth}
          tabIndex={0}
          onKeyDown={handleResizeKeyDown}
          onPointerDown={handleResizePointerDown}
          onPointerMove={handleResizePointerMove}
          onPointerUp={handleResizePointerEnd}
          onPointerCancel={handleResizePointerEnd}
        />
      ) : null}
      {/* The side chat draws its own header (agent, history, new chat); Meeting keeps this one. */}
      {isRightChatPanelOpen && isMeetingContext ? (
        <header className="notia-right-panel-header">
          <span className="notia-right-panel-title">
            <Sparkles size={15} strokeWidth={1.75} aria-hidden="true" />
            Asistente de la reunión
          </span>
          <button
            type="button"
            className="notia-panel-action"
            aria-label="Cerrar asistente"
            title="Cerrar asistente"
            onClick={handleToggleRightPanel}
          >
            <X size={15} strokeWidth={1.75} />
          </button>
        </header>
      ) : null}
      {isRightChatPanelOpen ? (
        isRightPanelChatMounted ? (
          isMeetingContext ? (
            <MeetingEphemeralChat
              aiPreferences={aiPreferences}
              library={activeLibrary}
              onLibraryChanged={handleChatWorkspaceTreeChanged}
            />
          ) : (
            <PerformanceProfiler id="chat-right-panel">
              <ChatWorkspaceView
                agentCorpusPaths={agentCorpusPaths}
                agentScope={agentScope}
                key={rightPanelChatContextKey}
                library={activeLibrary}
                aiPreferences={aiPreferences}
                previousChats={previousChats}
                showHistoryPanel={false}
                composerContext={rightPanelChatContext}
                onClosePanel={handleToggleRightPanel}
                preferredContextPaths={rightPanelPreferredContextPaths}
                preferredContextName={rightPanelPreferredContextName}
                preferredContextMode={rightPanelPreferredContextMode}
                preferredContextScopeKey={rightPanelPreferredContextScopeKey}
                transientContextPaths={rightPanelTransientContextPaths}
                transientContextMode={rightPanelTransientContextMode}
                transientContextSummary={rightPanelTransientContextSummary}
                transientContextContent={rightPanelTransientContextSummary}
                transientContextDisplayPaths={rightPanelTransientSelectedPaths}
                 onTransientContextPathRemove={handleTransientContextPathRemove}
                persistTransientContext={false}
                selectMatchingChatOnly={shouldSelectMatchingRightPanelChat(rightPanelPreferredContextScopeKey, rightPanelPreferredContextPaths)}
                onChatCreated={chatCallbacks.onChatCreated}
                onChatDeleted={chatCallbacks.onChatDeleted}
                markdownSelection={markdownSelection}
                activeMarkdownSource={activeMarkdownSource}
                onActiveMarkdownDocumentChanged={onActiveMarkdownDocumentChanged}
              />
            </PerformanceProfiler>
          )
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
