import { memo, useEffect, useMemo, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'
import { shallowEqual } from 'react-redux'
import { useAppSelector } from '../../store/hooks'
import { selectIsRightChatPanelOpen, selectIsRightPanelChatMounted } from '../../features/ui/uiSelectors'
import { selectActiveLibrary } from '../../features/library/librarySelectors'
import { selectAiSettings } from '../../features/preferences/preferencesSelectors'
import { useNotiaAction } from '../../context/notiaActions/useNotiaAction'
import { ChatWorkspaceView } from './views/chat/ChatWorkspaceView'
import type { ChatFileContextMode } from '../../services/chat/chatAttachmentRuntime'
import {
  clampRightPanelWidth,
  loadRightPanelWidth,
  saveRightPanelWidth,
} from '../../services/preferences/rightPanelStorage'

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
  const [panelWidth, setPanelWidth] = useState(() => loadRightPanelWidth(window.innerWidth))
  const [isResizing, setIsResizing] = useState(false)

  useEffect(() => {
    const handleViewportResize = () => {
      setPanelWidth((currentWidth) => clampRightPanelWidth(currentWidth, window.innerWidth))
    }
    window.addEventListener('resize', handleViewportResize)
    return () => window.removeEventListener('resize', handleViewportResize)
  }, [])

  const updatePanelWidth = (nextWidth: number) => {
    const clampedWidth = clampRightPanelWidth(nextWidth, window.innerWidth)
    setPanelWidth(clampedWidth)
    saveRightPanelWidth(clampedWidth)
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
    setIsResizing(false)
  }

  const handleResizeKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
      return
    }
    event.preventDefault()
    updatePanelWidth(panelWidth + (event.key === 'ArrowLeft' ? 16 : -16))
  }

  const chatCallbacks = useMemo(() => ({
    onChatCreated: handleChatWorkspaceTreeChanged,
    onChatDeleted: handleChatWorkspaceTreeChanged,
  }), [handleChatWorkspaceTreeChanged])

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
