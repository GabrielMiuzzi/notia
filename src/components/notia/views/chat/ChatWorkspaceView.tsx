import { memo, useEffect, useLayoutEffect, useRef, useCallback } from 'react'
import { useAppDispatch } from '../../../../store/hooks'
import { openSettingsToSection } from '../../../../features/ui/uiSlice'
import { useSubmenuEngine } from '../../../../hooks/useSubmenuEngine'
import { NotiaSubmenuPanel } from '../../NotiaSubmenuPanel'
import { useConfirmationEngine } from '../../../../context/confirmation/useConfirmationEngine'
import { AppDialogModal } from '../../AppDialogModal'
import { CreateChatModal, type CreateChatModalSubmitPayload } from '../../CreateChatModal'
import { ChatLibraryFilesModal } from './ChatLibraryFilesModal'
import { ChatThread } from './ChatThread'
import { ChatComposer } from './ChatComposer'
import {
  ChatHeaderComponent,
  ChatHistoryPanel,
  ChatHistoryPanelHeaderCompact,
} from './ChatHistoryPanel'
import {
  deleteChatDraftFile,
  createChatDraftFile,
} from '../../../../services/chat/chatSessionStorage'
import { clearLongTermMemories } from '../../../../services/chat/chatDocumentStorage'
import { readImageFileAsAttachment } from './chatImageAttachment'
import { useChatState } from './useChatState'
import { useChatSubmitMessage } from './useChatSubmitMessage'
import { useChatAttachmentMenu } from './useChatAttachmentMenu'
import { notiaTimer } from '../../../../services/runtime/notiaLogger'
import type { ChatWorkspaceViewProps } from './ChatWorkspaceViewTypes'

const EMPTY_PREVIOUS_CHATS: Array<{ id: string; title: string; filePath: string }> = []
const EMPTY_CONTEXT_PATHS: string[] = []
const DEFAULT_SUGGESTIONS = [
  'Resume estas notas',
  'Conecta ideas relacionadas',
  'Dame proximos pasos concretos',
]

export function ChatWorkspaceViewComponent({
  library,
  aiPreferences,
  previousChats = EMPTY_PREVIOUS_CHATS,
  title = 'Notia Chat',
  description = 'Una vista de chat reutilizable para futuras integraciones.',
  suggestions = DEFAULT_SUGGESTIONS,
  showHistoryPanel = true,
  composerContextLabel,
  preferredContextPaths = EMPTY_CONTEXT_PATHS,
  preferredContextName = null,
  preferredContextMode = null,
  preferredContextScopeKey = null,
  transientContextPaths = EMPTY_CONTEXT_PATHS,
  transientContextMode = null,
  transientContextSummary = null,
  persistTransientContext = false,
  selectMatchingChatOnly = false,
  historyHydrationMode = 'full',
  onChatCreated,
  onChatDeleted,
}: ChatWorkspaceViewProps) {
  const mountTimerRef = useRef(
    notiaTimer('chat', 'ChatWorkspaceView mount', {
      showHistoryPanel,
      selectMatchingChatOnly,
      historyHydrationMode,
    }),
  )
  useEffect(() => {
    const timer = mountTimerRef.current
    return () => {
      timer.success()
    }
  }, [])

  const chatState = useChatState({
    library,
    aiPreferences,
    previousChats,
    suggestions,
    preferredContextPaths,
    preferredContextName,
    preferredContextMode,
    preferredContextScopeKey,
    transientContextPaths,
    transientContextMode,
    transientContextSummary,
    persistTransientContext,
    selectMatchingChatOnly,
    historyHydrationMode,
  })

  const {
    selectedChatFilePath,
    setSelectedChatFilePath,
    activeChatDocument,
    setActiveChatDocument,
    isChatLoading,
    setChatTitleOverrides,
    setMatchedPreferredChatFilePath,
    setPendingAutoCreatedChatFilePath,

    draft,
    setDraft,
    isSubmitting,
    setIsSubmitting,

    isHistoryPanelOpen,
    setIsHistoryPanelOpen,
    isCreateChatModalOpen,
    setIsCreateChatModalOpen,
    createChatErrorMessage,
    setCreateChatErrorMessage,
    isCreateChatSubmitting,
    setIsCreateChatSubmitting,
    dialogMessage,
    setDialogMessage,
    isChatToolsModalOpen,
    setIsChatToolsModalOpen,
    isLibraryFilesModalOpen,
    setIsLibraryFilesModalOpen,
    isClearingLongTermMemory,
    setIsClearingLongTermMemory,
    chatContextMenuState,
    setChatContextMenuState,
    setLocallyDeletedChatPaths,

    isAttachmentMenuOpen,
    setIsAttachmentMenuOpen,
    attachmentMenuPosition,
    setAttachmentMenuPosition,
    selectedImageAttachment,
    setSelectedImageAttachment,
    selectedLibraryFilePaths,
    setSelectedLibraryFilePaths,
    selectedLibraryFileOptions,
    setSelectedLibraryFileOptions,
    selectedFileContextMode,
    setSelectedFileContextMode,

    streamingThinking,
    setStreamingThinking,
    streamingAssistantMessage,
    setStreamingAssistantMessage,
    setOptimisticThreadMessages,

    isCheckingAiHealth,
    aiAvailabilityMessage,

    displayedMessages,
    effectiveSelectedContextPaths,
    effectiveSelectedContextMode,
    hasTransientContext,
    transientContextSummaryLabel,
    selectedLibraryFileSummary,
    resolvedPreviousChats,
    availablePreviousChats,
    compactRecentChats,
    visibleSuggestions,
    canSubmit,
    isAiAvailable,
    activeModelLabel,
    isResolvingActiveModel,

    chatHistoryListRef,
    virtualChatHistoryItems,
    chatHistoryTotalSize,
  } = chatState

  const { confirm } = useConfirmationEngine()
  const dispatch = useAppDispatch()
  const imageInputRef = useRef<HTMLInputElement | null>(null)
  const chatThreadRef = useRef<HTMLDivElement | null>(null)

  useLayoutEffect(() => {
    const thread = chatThreadRef.current
    if (!thread) {
      return
    }
    thread.scrollTop = thread.scrollHeight
  }, [displayedMessages.length, isSubmitting, streamingAssistantMessage, streamingThinking])

  const handleOpenAiSettings = useCallback(() => {
    dispatch(openSettingsToSection('IA'))
  }, [dispatch])

  const resolvedActiveModel = activeModelLabel
    ? `Modelo: ${activeModelLabel}`
    : isResolvingActiveModel
      ? 'Modelo: ...'
      : 'Modelo: por defecto'


  const {
    panelRef: chatContextMenuPanelRef,
  } = useSubmenuEngine<HTMLButtonElement, HTMLDivElement>({
    open: Boolean(chatContextMenuState),
    onClose: () => {
      setChatContextMenuState(null)
    },
  })
  const {
    triggerRef: attachmentMenuTriggerRef,
    panelRef: attachmentMenuPanelRef,
  } = useSubmenuEngine<HTMLButtonElement, HTMLDivElement>({
    open: isAttachmentMenuOpen,
    onClose: () => {
      setIsAttachmentMenuOpen(false)
    },
  })

  useChatAttachmentMenu(
    isAttachmentMenuOpen,
    setAttachmentMenuPosition,
    attachmentMenuTriggerRef,
    attachmentMenuPanelRef,
  )

  const { submitMessage, cancelActiveReply } = useChatSubmitMessage(
    {
      library,
      aiPreferences,
      activeChatDocument,
      selectedChatFilePath,
      effectiveSelectedContextPaths,
      effectiveSelectedContextMode,
      selectedLibraryFilePaths,
      selectedLibraryFileOptions,
      selectedImageAttachment,
      selectedFileContextMode,
      showHistoryPanel,
      preferredContextScopeKey,
      persistTransientContext,
      hasTransientContext,
      onChatCreated,
    },
    {
      draft,
      setDraft,
      isSubmitting,
      setIsSubmitting,
      setOptimisticThreadMessages,
      setStreamingThinking,
      setStreamingAssistantMessage,
      setSelectedChatFilePath,
      setActiveChatDocument,
      setChatTitleOverrides,
      setSelectedImageAttachment,
      setSelectedLibraryFilePaths,
      setSelectedLibraryFileOptions,
      setSelectedFileContextMode,
      setPendingAutoCreatedChatFilePath,
      setIsAttachmentMenuOpen,
      setDialogMessage,
    },
  )

  const handleCreateChat = async (payload: CreateChatModalSubmitPayload) => {
    if (!library || isCreateChatSubmitting) {
      return
    }

    setCreateChatErrorMessage(null)
    setIsCreateChatSubmitting(true)

    try {
      const { filePath } = await createChatDraftFile(library, payload)
      setIsCreateChatModalOpen(false)
      setSelectedChatFilePath(filePath)
      setMatchedPreferredChatFilePath(filePath)
      await onChatCreated?.(filePath)
    } catch (error) {
      setCreateChatErrorMessage(
        error instanceof Error && error.message.trim()
          ? error.message
          : 'No se pudo crear el archivo del chat.',
      )
    } finally {
      setIsCreateChatSubmitting(false)
    }
  }

  const handleDeleteChat = async () => {
    if (!chatContextMenuState || !library) {
      return
    }

    const targetChat = chatContextMenuState
    setChatContextMenuState(null)

    const accepted = await confirm({
      title: 'Eliminar chat',
      message: `Se va a eliminar "${targetChat.title}" de forma permanente. No hay forma de recuperarlo despues. ¿Querés continuar?`,
      confirmLabel: 'Eliminar',
      cancelLabel: 'Cancelar',
      tone: 'danger',
    })

    if (!accepted) {
      return
    }

    try {
      setLocallyDeletedChatPaths((current) => (
        current.includes(targetChat.filePath) ? current : [...current, targetChat.filePath]
      ))
      await deleteChatDraftFile(targetChat.filePath, library)
      if (selectedChatFilePath === targetChat.filePath) {
        setSelectedChatFilePath(null)
        setActiveChatDocument(null)
      }
      await onChatDeleted?.(targetChat.filePath)
    } catch (error) {
      setLocallyDeletedChatPaths((current) => current.filter((filePath) => filePath !== targetChat.filePath))
      setDialogMessage(
        error instanceof Error && error.message.trim()
          ? error.message
          : 'No se pudo eliminar el archivo del chat.',
      )
    }
  }

  const handleClearLongTermMemory = async () => {
    if (!library || isClearingLongTermMemory) {
      return
    }

    const accepted = await confirm({
      title: 'Borrar LongTermMemory',
      message: 'Se va a vaciar LongTermMemory.md por completo. Una vez hecho, no hay vuelta atras. ¿Querés continuar?',
      confirmLabel: 'Borrar memoria',
      cancelLabel: 'Cancelar',
      tone: 'danger',
    })

    if (!accepted) {
      return
    }

    setIsClearingLongTermMemory(true)

    try {
      await clearLongTermMemories(library)
      setIsChatToolsModalOpen(false)
    } catch (error) {
      setDialogMessage(
        error instanceof Error && error.message.trim()
          ? error.message
          : 'No se pudo vaciar LongTermMemory.md.',
      )
    } finally {
      setIsClearingLongTermMemory(false)
    }
  }

  useEffect(() => {
    const key = 'onImageSelected'
    const windowProxy = window as unknown as { [key]?: (file: File) => Promise<void> }
    windowProxy[key] = async (file: File) => {
      try {
        const attachment = await readImageFileAsAttachment(file)
        setSelectedImageAttachment(attachment)
      } catch (error) {
        setDialogMessage(
          error instanceof Error && error.message.trim()
            ? error.message
            : 'No se pudo cargar la imagen seleccionada.',
        )
      }
    }
    return () => {
      delete windowProxy[key]
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleRemoveSelectedFile = (path: string) => {
    setSelectedLibraryFilePaths((current) => current.filter((item) => item !== path))
  }

  const handleOpenAttachmentMenu = () => {
    if (!library || !isAiAvailable) {
      return
    }
    setIsAttachmentMenuOpen((current) => !current)
  }

  return (
    <main className="notia-main notia-chat-view" data-notia-prevent-menu-close>
      <section className="notia-chat-shell" data-notia-prevent-menu-close>
        <div className="notia-chat-layout" data-notia-prevent-menu-close>
          {showHistoryPanel ? (
            <ChatHistoryPanel
              library={library}
              selectedChatFilePath={selectedChatFilePath}
              setSelectedChatFilePath={setSelectedChatFilePath}
              setIsCreateChatModalOpen={setIsCreateChatModalOpen}
              setCreateChatErrorMessage={setCreateChatErrorMessage}
              setIsChatToolsModalOpen={setIsChatToolsModalOpen}
              setChatContextMenuState={setChatContextMenuState}
              isHistoryPanelOpen={isHistoryPanelOpen}
              setIsHistoryPanelOpen={setIsHistoryPanelOpen}
              resolvedPreviousChats={resolvedPreviousChats}
              availablePreviousChats={availablePreviousChats}
              compactRecentChats={compactRecentChats}
              virtualChatHistoryItems={virtualChatHistoryItems}
              chatHistoryTotalSize={chatHistoryTotalSize}
              chatHistoryListRef={chatHistoryListRef}
            />
          ) : null}

          <section className="notia-chat-main">
            {showHistoryPanel ? (
              <ChatHeaderComponent
                title={title}
                activeChatTitle={activeChatDocument?.title}
                description={description}
                suggestions={visibleSuggestions}
                setDraft={setDraft}
              />
            ) : (
              <ChatHistoryPanelHeaderCompact
                title={activeChatDocument?.title ?? title}
                description={description}
                compactRecentChats={compactRecentChats}
                selectedChatFilePath={selectedChatFilePath}
                setSelectedChatFilePath={setSelectedChatFilePath}
              />
            )}

            <ChatThread
              messages={displayedMessages}
              isSubmitting={isSubmitting}
              isChatLoading={isChatLoading}
              isCheckingAiHealth={isCheckingAiHealth}
              aiAvailabilityMessage={aiAvailabilityMessage}
              selectedChatFilePath={selectedChatFilePath}
              showHistoryPanel={showHistoryPanel}
              streamingThinking={streamingThinking}
              streamingAssistantMessage={streamingAssistantMessage}
              threadRef={chatThreadRef}
              onOpenAiSettings={handleOpenAiSettings}
            />

            <ChatComposer
              draft={draft}
              setDraft={setDraft}
              canSubmit={canSubmit}
              isSubmitting={isSubmitting}
              isAiAvailable={isAiAvailable}
              library={library}
              composerContextLabel={composerContextLabel}
              activeModelLabel={resolvedActiveModel}
              selectedImageAttachment={selectedImageAttachment}
              selectedLibraryFileSummary={selectedLibraryFileSummary}
              selectedLibraryFilePaths={selectedLibraryFilePaths}
              effectiveSelectedContextPaths={effectiveSelectedContextPaths}
              effectiveSelectedContextMode={effectiveSelectedContextMode}
              transientContextSummaryLabel={transientContextSummaryLabel}
              hasTransientContext={hasTransientContext}
              isAttachmentMenuOpen={isAttachmentMenuOpen}
              attachmentMenuPosition={attachmentMenuPosition}
              onRemoveImage={() => {
                setSelectedImageAttachment(null)
              }}
              onRemoveFile={handleRemoveSelectedFile}
              onToggleAttachmentMenu={handleOpenAttachmentMenu}
              onSelectImage={() => {
                setIsAttachmentMenuOpen(false)
                imageInputRef.current?.click()
              }}
              onOpenLibraryFilesModal={() => {
                setIsAttachmentMenuOpen(false)
                setIsLibraryFilesModalOpen(true)
              }}
              onSubmit={() => {
                void submitMessage(draft)
              }}
              onCancel={cancelActiveReply}
              triggerRef={attachmentMenuTriggerRef}
              panelRef={attachmentMenuPanelRef}
              imageInputRef={imageInputRef}
            />
          </section>
        </div>

        <ChatLibraryFilesModal
          open={isLibraryFilesModalOpen}
          library={library}
          selectedPaths={selectedLibraryFilePaths}
          contextMode={selectedFileContextMode}
          onClose={() => {
            setIsLibraryFilesModalOpen(false)
          }}
          onApply={({ selectedPaths, selectedOptions, contextMode }) => {
            setSelectedLibraryFilePaths(selectedPaths)
            setSelectedLibraryFileOptions(selectedOptions)
            setSelectedFileContextMode(contextMode)
            setIsLibraryFilesModalOpen(false)
          }}
        />
        <CreateChatModal
          open={isCreateChatModalOpen}
          errorMessage={createChatErrorMessage}
          isSubmitting={isCreateChatSubmitting}
          onClose={() => {
            if (isCreateChatSubmitting) {
              return
            }
            setCreateChatErrorMessage(null)
            setIsCreateChatModalOpen(false)
          }}
          onSubmit={(payload) => {
            void handleCreateChat(payload)
          }}
        />
        <AppDialogModal
          open={isChatToolsModalOpen}
          title="Memoria del chat"
          message="Administrá la memoria persistente compartida entre chats. Si borrás LongTermMemory, se vacía el archivo y la IA deja de usar esas memorias hasta que vuelvas a completarlo."
          confirmLabel={isClearingLongTermMemory ? 'Borrando...' : 'Borrar LongTermMemory'}
          cancelLabel="Cerrar"
          onConfirm={() => {
            void handleClearLongTermMemory()
          }}
          onClose={() => {
            if (isClearingLongTermMemory) {
              return
            }
            setIsChatToolsModalOpen(false)
          }}
        />
        {chatContextMenuState ? (
          <NotiaSubmenuPanel
            ref={chatContextMenuPanelRef}
            className="notia-chat-context-menu"
            style={{
              position: 'fixed',
              top: `${chatContextMenuState.top}px`,
              left: `${chatContextMenuState.left}px`,
            }}
          >
            <button
              type="button"
              className="notia-chat-context-menu-item notia-chat-context-menu-item--danger"
              onClick={() => {
                void handleDeleteChat()
              }}
            >
              Eliminar chat
            </button>
          </NotiaSubmenuPanel>
        ) : null}
        <AppDialogModal
          open={Boolean(dialogMessage)}
          title="No se pudo completar la accion"
          message={dialogMessage ?? ''}
          onConfirm={() => {
            setDialogMessage(null)
          }}
          onClose={() => {
            setDialogMessage(null)
          }}
        />
      </section>
    </main>
  )
}

function areStringArraysEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false
  }

  return left.every((value, index) => value === right[index])
}

function arePreviousChatArraysEqual(
  left: Array<{ id: string; title: string; filePath: string }>,
  right: Array<{ id: string; title: string; filePath: string }>,
): boolean {
  if (left.length !== right.length) {
    return false
  }

  return left.every((chat, index) => {
    const candidate = right[index]
    return Boolean(candidate)
      && chat.id === candidate.id
      && chat.filePath === candidate.filePath
      && chat.title === candidate.title
  })
}

function areChatWorkspaceViewPropsEqual(
  previous: ChatWorkspaceViewProps,
  next: ChatWorkspaceViewProps,
): boolean {
  if (previous.library !== next.library) {
    return false
  }

  if (previous.aiPreferences !== next.aiPreferences) {
    return false
  }

  if (!arePreviousChatArraysEqual(previous.previousChats ?? EMPTY_PREVIOUS_CHATS, next.previousChats ?? EMPTY_PREVIOUS_CHATS)) {
    return false
  }

  if (previous.title !== next.title) {
    return false
  }

  if (previous.description !== next.description) {
    return false
  }

  if (!areStringArraysEqual(previous.suggestions ?? DEFAULT_SUGGESTIONS, next.suggestions ?? DEFAULT_SUGGESTIONS)) {
    return false
  }

  if (previous.showHistoryPanel !== next.showHistoryPanel) {
    return false
  }

  if (previous.composerContextLabel !== next.composerContextLabel) {
    return false
  }

  if (!areStringArraysEqual(previous.preferredContextPaths ?? EMPTY_CONTEXT_PATHS, next.preferredContextPaths ?? EMPTY_CONTEXT_PATHS)) {
    return false
  }

  if (previous.preferredContextName !== next.preferredContextName) {
    return false
  }

  if (previous.preferredContextMode !== next.preferredContextMode) {
    return false
  }

  if (previous.preferredContextScopeKey !== next.preferredContextScopeKey) {
    return false
  }

  if (!areStringArraysEqual(previous.transientContextPaths ?? EMPTY_CONTEXT_PATHS, next.transientContextPaths ?? EMPTY_CONTEXT_PATHS)) {
    return false
  }

  if (previous.transientContextMode !== next.transientContextMode) {
    return false
  }

  if (previous.transientContextSummary !== next.transientContextSummary) {
    return false
  }

  if (previous.persistTransientContext !== next.persistTransientContext) {
    return false
  }

  if (previous.selectMatchingChatOnly !== next.selectMatchingChatOnly) {
    return false
  }

  if (previous.historyHydrationMode !== next.historyHydrationMode) {
    return false
  }

  if (previous.onChatCreated !== next.onChatCreated) {
    return false
  }

  if (previous.onChatDeleted !== next.onChatDeleted) {
    return false
  }

  return true
}

export const ChatWorkspaceView = memo(ChatWorkspaceViewComponent, areChatWorkspaceViewPropsEqual)
ChatWorkspaceView.displayName = 'ChatWorkspaceView'
