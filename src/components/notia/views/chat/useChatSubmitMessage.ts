import { useEffect, useRef } from 'react'
import type { StoredChatDocument, StoredChatMessage } from '../../../../services/chat/chatDocumentStorage'
import { createChatDraftFile } from '../../../../services/chat/chatSessionStorage'
import { checkAiHealth } from '../../../../services/ai/aiRuntime'
import { startChatTurn, subscribeChatTitles, type ChatTurnHandle } from '../../../../services/chat/aiChatRuntime'
import { startPerformanceMeasurement } from '../../../../services/runtime/performanceBaseline'
import { readLibraryDocument } from '../../../../services/libraries/libraryDocumentRuntime'
import { buildAutoCreateChatPayload, normalizeChatTitle } from './useChatState'
import type {
  UseChatSubmitMessageDependencies,
  UseChatSubmitMessageState,
} from './ChatWorkspaceViewTypes'
import { describeAiFeedbackError } from '../../../../services/ai/aiFeedbackRuntime'

/**
 * Sends the composer's message as a chat turn. The backend picks the
 * messages the agent sees, runs it, saves the turn and names new chats; this
 * hook shows the turn optimistically, streams the answer and restores the
 * composer when the turn fails.
 */
export function useChatSubmitMessage(
  deps: UseChatSubmitMessageDependencies,
  state: UseChatSubmitMessageState,
): {
  submitMessage: (rawMessage: string, keepExecutionPlan?: boolean, undoOperationId?: string) => Promise<void>
  cancelActiveReply: () => void
} {
  const {
    agentCorpusPaths,
    agentScope,
    agentPromptFileName,
    requestAgentClarification,
    requestAgentConfirmation,
    onAgentExecutionPlanChange,
    onAgentProgress,
    requestAgentExecutionPlanApproval,
    library,
    aiPreferences,
    activeChatDocument,
    selectedChatFilePath,
    effectiveSelectedContextPaths,
    effectiveSelectedContextMode,
    selectedLibraryFilePaths,
    selectedLibraryFileOptions,
    selectedImageAttachments,
    selectedFileContextMode,
    selectedLibraryFolderPaths = [],
    libraryRagEnabled = true,
    newChatAgentMemoryEnabled = true,
    ephemeralChat = false,
    preferredContextScopeKey,
    persistTransientContext,
    hasTransientContext,
    transientContextContent,
    multichatRoomId,
    activeMarkdownSource,
    workspaceSnapshot,
    onActiveMarkdownDocumentChanged,
    onChatCreated,
  } = deps

  const {
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
    setSelectedImageAttachments,
    setSelectedLibraryFilePaths,
    setSelectedLibraryFileOptions,
    setSelectedFileContextMode,
    setPendingAutoCreatedChatFilePath,
    setIsAttachmentMenuOpen,
    setDialogMessage,
  } = state

  const activeReplyRef = useRef<ChatTurnHandle | null>(null)
  const mountedRef = useRef(true)
  const selectedChatFilePathRef = useRef(selectedChatFilePath)
  selectedChatFilePathRef.current = selectedChatFilePath
  const libraryId = library?.id ?? null

  useEffect(() => {
    mountedRef.current = true
    // La solicitud de IA vive en el runtime nativo y puede continuar aunque la
    // interfaz pase a segundo plano (pantalla bloqueada, cambio de app). La
    // cancelación solo ocurre al desmontar o por pedido explícito de la persona.
    const cancelOnPageHide = () => {
      activeReplyRef.current?.abort()
      activeReplyRef.current = null
    }
    window.addEventListener('pagehide', cancelOnPageHide)
    return () => {
      window.removeEventListener('pagehide', cancelOnPageHide)
      mountedRef.current = false
      cancelOnPageHide()
    }
  }, [])

  // The backend names a new chat after its first turn.
  useEffect(() => {
    if (!libraryId) return
    let disposed = false
    let unlisten: (() => void) | null = null
    void subscribeChatTitles((event) => {
      if (event.libraryId !== libraryId) return
      setActiveChatDocument((current) => (
        current && selectedChatFilePathRef.current === event.path ? { ...current, title: event.title } : current
      ))
      setChatTitleOverrides((current) => ({ ...current, [event.path]: normalizeChatTitle(event.title) }))
    }).then((stop) => {
      if (disposed) stop()
      else unlisten = stop
    })
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [libraryId, setActiveChatDocument, setChatTitleOverrides])

  function cancelActiveReply(): void {
    activeReplyRef.current?.abort()
    activeReplyRef.current = null
  }

  const submitMessage = async (rawMessage: string, keepExecutionPlan?: boolean, undoOperationId?: string) => {
    const trimmedMessage = rawMessage.trim()
    if (!trimmedMessage || isSubmitting || !library) {
      return
    }

    const submitMeasurement = startPerformanceMeasurement('chat.submit_message', {
      chatFilePath: selectedChatFilePath ?? undefined,
      contextFileCount: effectiveSelectedContextPaths.length,
      hasImage: selectedImageAttachments.length > 0,
      libraryId: library.id,
      messageLength: trimmedMessage.length,
    })

    const healthResult = await checkAiHealth(aiPreferences)
    if (!mountedRef.current) return
    if (!healthResult.ok) {
      submitMeasurement.error(new Error(healthResult.message || 'No se pudo conectar con la IA.'), {
        stage: 'health_check',
      })
      setDialogMessage(healthResult.message || 'No se pudo conectar con la IA.')
      return
    }

    const selection = {
      scopeKey: preferredContextScopeKey,
      files: effectiveSelectedContextPaths,
      folders: hasTransientContext ? [] : selectedLibraryFolderPaths,
      mode: effectiveSelectedContextMode,
      libraryRag: libraryRagEnabled,
      keepChatContext: hasTransientContext && !persistTransientContext,
    }
    let targetChatDocument = activeChatDocument
    let targetChatFilePath = selectedChatFilePath

    if (!targetChatDocument || !targetChatFilePath) {
      if (ephemeralChat) {
        targetChatDocument = {
          title: 'Chat efímero',
          ...buildAutoCreateChatPayload(newChatAgentMemoryEnabled),
          contextScopeKey: preferredContextScopeKey,
          selectedContextMode: 'direct',
          selectedContextFiles: [],
          selectedContextFolders: [],
          libraryRagEnabled: true,
          messages: [],
        }
        targetChatFilePath = null
      } else try {
        const created = await createChatDraftFile(library, buildAutoCreateChatPayload(newChatAgentMemoryEnabled), selection)
        if (!mountedRef.current) return
        setPendingAutoCreatedChatFilePath(created.filePath)
        setSelectedChatFilePath(created.filePath)
        await onChatCreated?.(created.filePath)
        if (!mountedRef.current) return
        targetChatDocument = created.document
        targetChatFilePath = created.filePath
      } catch (error) {
        submitMeasurement.error(error, {
          stage: 'create_chat',
        })
        setDialogMessage(
          error instanceof Error && error.message.trim()
            ? error.message
            : 'No se pudo crear el chat automáticamente.',
        )
        return
      }
    }

    const userMessage = {
      role: 'user',
      content: trimmedMessage,
      ...(selectedImageAttachments.length > 0 ? { attachments: selectedImageAttachments } : {}),
    } satisfies StoredChatMessage
    const previousImageAttachments = selectedImageAttachments
    const previousLibraryFilePaths = selectedLibraryFilePaths
    const previousLibraryFileOptions = selectedLibraryFileOptions
    const previousFileContextMode = selectedFileContextMode
    const previousChatDocument: StoredChatDocument = targetChatDocument
    const optimisticMessages = [...targetChatDocument.messages, userMessage]
    const previousDraft = draft

    setDraft('')
    setIsSubmitting(true)
    setOptimisticThreadMessages(optimisticMessages)
    setIsAttachmentMenuOpen(false)
    setStreamingThinking('')
    setStreamingAssistantMessage('')
    setSelectedImageAttachments([])
    setActiveChatDocument({ ...targetChatDocument, messages: optimisticMessages })

    const aiReplyMeasurement = startPerformanceMeasurement('chat.ai_reply', {
      contextFileCount: effectiveSelectedContextPaths.length,
      hasImage: selectedImageAttachments.length > 0,
      libraryId: library.id,
      messageLength: trimmedMessage.length,
    })

    try {
      const effectiveAgentScope = agentScope ?? 'library'
      if (!keepExecutionPlan) onAgentExecutionPlanChange([])
      const turn = startChatTurn({
        libraryId: library.id,
        mode: 'chat',
        preferences: aiPreferences,
        scope: effectiveAgentScope,
        message: trimmedMessage,
        context: transientContextContent,
        multichatRoomId: multichatRoomId ?? undefined,
        attachments: selectedImageAttachments,
        promptName: agentPromptFileName || undefined,
        undoOperationId,
        workspace: workspaceSnapshot,
        selection,
        chat: targetChatFilePath
          ? { kind: 'saved', path: targetChatFilePath }
          : { kind: 'ephemeral', document: targetChatDocument },
      }, {
        onThinkingDelta: (delta) => setStreamingThinking((current) => current + delta),
        onMessageDelta: (delta) => setStreamingAssistantMessage((current) => current + delta),
        onAgentProgress,
        requestClarification: requestAgentClarification,
        requestConfirmation: requestAgentConfirmation,
        requestExecutionPlanApproval: requestAgentExecutionPlanApproval,
      })
      activeReplyRef.current = turn
      const outcome = await turn.promise
      if (!mountedRef.current) return
      activeReplyRef.current = null
      if (outcome.undoneOperationId) {
        onAgentProgress?.({
          type: 'tool-completed',
          requestId: turn.requestId,
          operationId: outcome.undoneOperationId,
          round: 0,
          toolName: 'undo_ai_operation',
          ok: true,
          changed: true,
        })
      }
      // The open note is reloaded after the reply so the editor shows the agent's edit.
      const activeDocumentPath = effectiveAgentScope === 'document' ? agentCorpusPaths[0] : undefined
      if (outcome.dataChanged && activeDocumentPath && onActiveMarkdownDocumentChanged) {
        const refreshed = await readLibraryDocument(library.id, activeDocumentPath)
        if (refreshed.ok && refreshed.content !== activeMarkdownSource) {
          await onActiveMarkdownDocumentChanged(activeDocumentPath, refreshed.content, refreshed.revision)
        }
      }
      aiReplyMeasurement.success({
        responseLength: outcome.answer.length,
      })

      const persistedDocument: StoredChatDocument = outcome.document ?? {
        ...targetChatDocument,
        messages: [...optimisticMessages, { role: 'assistant', content: outcome.answer }],
      }
      setActiveChatDocument(persistedDocument)
      setOptimisticThreadMessages(null)
      setStreamingThinking('')
      setStreamingAssistantMessage('')
      if (targetChatFilePath) {
        setChatTitleOverrides((current) => ({
          ...current,
          [targetChatFilePath]: normalizeChatTitle(persistedDocument.title),
        }))
      }
      submitMeasurement.success({
        autoCreatedChat: !selectedChatFilePath,
        contextFileCount: effectiveSelectedContextPaths.length,
        responseLength: outcome.answer.length,
        totalMessageCount: persistedDocument.messages.length,
      })
    } catch (error) {
      activeReplyRef.current = null
      if (!mountedRef.current) return
      aiReplyMeasurement.error(error)
      submitMeasurement.error(error, {
        stage: 'stream_or_persist',
      })
      setPendingAutoCreatedChatFilePath((current) => (targetChatFilePath && current === targetChatFilePath ? null : current))
      setOptimisticThreadMessages(null)
      setDraft(previousDraft)
      setActiveChatDocument(previousChatDocument)
      setStreamingThinking('')
      setStreamingAssistantMessage('')
      setSelectedImageAttachments(previousImageAttachments)
      setSelectedLibraryFilePaths(previousLibraryFilePaths)
      setSelectedLibraryFileOptions(previousLibraryFileOptions)
      setSelectedFileContextMode(previousFileContextMode)
      setDialogMessage(
        describeAiFeedbackError(error, 'No se pudo completar la consulta con la IA.'),
      )
    } finally {
      if (mountedRef.current) {
        setIsSubmitting(false)
        // The submit button ended a tap; registering the window here lets the
        // tap-to-mount path suppress the phantom native click that follows.
        deps.beginPhantomClickSuppression?.(document.activeElement)
      }
    }
  }

  return { submitMessage, cancelActiveReply }
}
