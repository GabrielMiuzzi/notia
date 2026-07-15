import { appendChatMessages, saveChatDocument, type StoredChatDocument } from '../../../../services/chat/chatDocumentStorage'
import { buildChatMemoryWindow, resolvePersistedChatTitle } from '../../../../services/chat/chatConversationRuntime'
import { createChatDraftFile } from '../../../../services/chat/chatSessionStorage'
import { scheduleLongTermMemoriesForTurn } from '../../../../services/chat/chatLongTermMemorySync'
import { scheduleAiChatTitle } from '../../../../services/chat/chatTitleSync'
import {
  checkAiHealth,
  startCancelableAiChatReply,
  type CancelableAiReplyHandle,
} from '../../../../services/ai/aiRuntime'
import { loadInlineFileAttachments } from '../../../../services/chat/chatAttachmentRuntime'
import { loadLongTermMemories } from '../../../../services/chat/chatDocumentStorage'
import { startPerformanceMeasurement } from '../../../../services/runtime/performanceBaseline'
import { buildAutoCreateChatPayload, normalizeChatTitle } from './useChatState'
import type {
  UseChatSubmitMessageDependencies,
  UseChatSubmitMessageState,
} from './ChatWorkspaceViewTypes'

export function useChatSubmitMessage(
  deps: UseChatSubmitMessageDependencies,
  state: UseChatSubmitMessageState,
): {
  submitMessage: (rawMessage: string) => Promise<void>
  cancelActiveReply: () => void
} {
  const {
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
  } = deps

  const {
    draft,
    setDraft,
    isSubmitting,
    setIsSubmitting,
    setOptimisticThreadMessages,
    setStreamingThinking,
    setStreamingAssistantMessage,
    setActiveChatDocument,
    setChatTitleOverrides,
    setSelectedImageAttachment,
    setSelectedLibraryFilePaths,
    setSelectedLibraryFileOptions,
    setSelectedFileContextMode,
    setPendingAutoCreatedChatFilePath,
    setIsAttachmentMenuOpen,
    setDialogMessage,
  } = state

  const activeReplyRef = { current: null as CancelableAiReplyHandle | null }

  function cancelActiveReply(): void {
    activeReplyRef.current?.abort()
    activeReplyRef.current = null
  }

  const selectedImageAttachmentRef = { current: selectedImageAttachment }
  selectedImageAttachmentRef.current = selectedImageAttachment

  return async (rawMessage: string) => {
    const trimmedMessage = rawMessage.trim()
    if (!trimmedMessage || isSubmitting || !library) {
      return
    }

    const submitMeasurement = startPerformanceMeasurement('chat.submit_message', {
      chatFilePath: selectedChatFilePath ?? undefined,
      contextFileCount: effectiveSelectedContextPaths.length,
      hasImage: Boolean(selectedImageAttachmentRef.current),
      libraryId: library.id,
      messageLength: trimmedMessage.length,
    })

    const healthResult = await checkAiHealth(aiPreferences)
    if (!healthResult.ok) {
      submitMeasurement.error(new Error(healthResult.message || 'No se pudo conectar con la IA.'), {
        stage: 'health_check',
      })
      setDialogMessage(healthResult.message || 'No se pudo conectar con la IA.')
      return
    }

    let targetChatDocument = activeChatDocument
    let targetChatFilePath = selectedChatFilePath

    if (!targetChatDocument || !targetChatFilePath) {
      try {
        const { filePath } = await createChatDraftFile(library, buildAutoCreateChatPayload(showHistoryPanel))
        setPendingAutoCreatedChatFilePath(filePath)
        await onChatCreated?.(filePath)
        const createdDocument = await loadChatDocument(filePath, 'Chat', library)
        const shouldDisableLongTermMemoryForAutoCreatedIndexChat =
          effectiveSelectedContextMode === 'index'
          && effectiveSelectedContextPaths.length > 0

        const preparedDocument: StoredChatDocument = shouldDisableLongTermMemoryForAutoCreatedIndexChat
          ? {
            ...createdDocument,
            contextScopeKey: preferredContextScopeKey ?? createdDocument.contextScopeKey,
            longTermMemoryEnabled: false,
            selectedContextMode: persistTransientContext ? 'index' : createdDocument.selectedContextMode,
            selectedContextFiles: persistTransientContext ? effectiveSelectedContextPaths : createdDocument.selectedContextFiles,
          }
          : {
            ...createdDocument,
            contextScopeKey: preferredContextScopeKey ?? createdDocument.contextScopeKey,
            selectedContextMode: persistTransientContext ? effectiveSelectedContextMode : createdDocument.selectedContextMode,
            selectedContextFiles: persistTransientContext ? effectiveSelectedContextPaths : createdDocument.selectedContextFiles,
          }

        if (
          preparedDocument.longTermMemoryEnabled !== createdDocument.longTermMemoryEnabled
          || preparedDocument.contextScopeKey !== createdDocument.contextScopeKey
          || preparedDocument.selectedContextMode !== createdDocument.selectedContextMode
          || preparedDocument.selectedContextFiles.join('\n') !== createdDocument.selectedContextFiles.join('\n')
        ) {
          await saveChatDocument(filePath, preparedDocument, library)
        }

        targetChatDocument = preparedDocument
        targetChatFilePath = filePath
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
    } as const

    let inlineFileAttachments: Awaited<ReturnType<typeof loadInlineFileAttachments>> = []
    let longTermMemories: string[] = []
    const previousImageAttachment = selectedImageAttachmentRef.current
    const previousLibraryFilePaths = selectedLibraryFilePaths
    const previousLibraryFileOptions = selectedLibraryFileOptions
    const previousFileContextMode = selectedFileContextMode

    try {
      inlineFileAttachments = await loadInlineFileAttachments(
        library,
        effectiveSelectedContextPaths,
        selectedLibraryFileOptions,
      )
    } catch (error) {
      submitMeasurement.error(error, {
        stage: 'load_inline_attachments',
      })
      setDialogMessage(
        error instanceof Error && error.message.trim()
          ? error.message
          : 'No se pudieron preparar los archivos seleccionados.',
      )
      return
    }

    if (targetChatDocument.longTermMemoryEnabled) {
      try {
        longTermMemories = await loadLongTermMemories(library)
      } catch (error) {
        submitMeasurement.error(error, {
          stage: 'load_long_term_memory',
        })
        setDialogMessage(
          error instanceof Error && error.message.trim()
            ? error.message
            : 'No se pudo leer LongTermMemory.md.',
        )
        return
      }
    }

    const previousMessages = targetChatDocument.messages
    const chatMemory = buildChatMemoryWindow(targetChatDocument)
    const optimisticMessages = [...previousMessages, userMessage]
    const previousDraft = draft
    const nextChatDocumentBase: StoredChatDocument = {
      ...targetChatDocument,
      contextScopeKey: preferredContextScopeKey ?? targetChatDocument.contextScopeKey,
      selectedContextFiles: hasTransientContext && !persistTransientContext
        ? targetChatDocument.selectedContextFiles
        : effectiveSelectedContextPaths,
      selectedContextMode: hasTransientContext && !persistTransientContext
        ? targetChatDocument.selectedContextMode
        : effectiveSelectedContextMode,
      messages: optimisticMessages,
    }

    setDraft('')
    setIsSubmitting(true)
    setOptimisticThreadMessages(optimisticMessages)
    setIsAttachmentMenuOpen(false)
    setStreamingThinking('')
    setStreamingAssistantMessage('')
    setSelectedImageAttachment(null)
    setActiveChatDocument(nextChatDocumentBase)

    const aiReplyMeasurement = startPerformanceMeasurement('chat.ai_reply', {
      contextFileCount: effectiveSelectedContextPaths.length,
      hasImage: Boolean(selectedImageAttachmentRef.current),
      libraryId: library.id,
      messageLength: trimmedMessage.length,
    })

    try {
      const replyHandle = startCancelableAiChatReply(
        aiPreferences,
        {
          prompt: trimmedMessage,
          previousMessages: chatMemory,
          longTermMemories,
          files: inlineFileAttachments,
          image: selectedImageAttachmentRef.current ?? undefined,
          selectedContextMode: effectiveSelectedContextMode,
        },
        {
          onMessageDelta: (delta) => {
            setStreamingAssistantMessage((current) => current + delta)
          },
        },
      )
      activeReplyRef.current = replyHandle
      const streamedAnswer = await replyHandle.promise
      activeReplyRef.current = null
      aiReplyMeasurement.success({
        responseLength: streamedAnswer.length,
      })

      const resolvedTitle = resolvePersistedChatTitle(
        targetChatDocument.title || 'Chat',
        previousMessages,
        trimmedMessage,
      )

      const persistedDocument: StoredChatDocument = {
        ...nextChatDocumentBase,
        title: resolvedTitle,
        messages: [...optimisticMessages, {
          role: 'assistant',
          content: streamedAnswer,
        }],
      }

      const titleChanged = resolvedTitle !== targetChatDocument.title
      if (titleChanged) {
        await saveChatDocument(targetChatFilePath, persistedDocument, library)
      } else {
        const appendResult = await appendChatMessages(targetChatFilePath, persistedDocument, library)
        if (!appendResult.appended) {
          await saveChatDocument(targetChatFilePath, persistedDocument, library)
        }
      }

      if (previousMessages.length === 0) {
        scheduleAiChatTitle(
          {
            library,
            aiPreferences,
            filePath: targetChatFilePath,
            document: persistedDocument,
            prompt: trimmedMessage,
          },
          {
            onPersisted: (title) => {
              setActiveChatDocument((current) => (
                current?.messages === persistedDocument.messages
                  ? { ...current, title }
                  : current
              ))
              setChatTitleOverrides((current) => (
                current[targetChatFilePath] === title
                  ? current
                  : {
                    ...current,
                    [targetChatFilePath]: normalizeChatTitle(title),
                  }
              ))
            },
          },
        )
      }

      if (persistedDocument.longTermMemoryEnabled) {
        scheduleLongTermMemoriesForTurn({
          library,
          aiPreferences,
          prompt: trimmedMessage,
          assistantReply: streamedAnswer,
          previousMessages,
          existingLongTermMemories: longTermMemories,
        })
      }

      setActiveChatDocument(persistedDocument)
      setOptimisticThreadMessages(null)
      setPendingAutoCreatedChatFilePath((current) => (current === targetChatFilePath ? null : current))
      setStreamingThinking('')
      setStreamingAssistantMessage('')
      setChatTitleOverrides((current) => ({
        ...current,
        [targetChatFilePath]: normalizeChatTitle(persistedDocument.title),
      }))
      submitMeasurement.success({
        autoCreatedChat: !selectedChatFilePath,
        contextFileCount: effectiveSelectedContextPaths.length,
        responseLength: streamedAnswer.length,
        totalMessageCount: persistedDocument.messages.length,
      })
    } catch (error) {
      activeReplyRef.current = null
      aiReplyMeasurement.error(error)
      submitMeasurement.error(error, {
        stage: 'stream_or_persist',
      })
      setPendingAutoCreatedChatFilePath((current) => (current === targetChatFilePath ? null : current))
      setOptimisticThreadMessages(null)
      setDraft(previousDraft)
      setActiveChatDocument(targetChatDocument)
      setStreamingThinking('')
      setStreamingAssistantMessage('')
      setSelectedImageAttachment(previousImageAttachment)
      setSelectedLibraryFilePaths(previousLibraryFilePaths)
      setSelectedLibraryFileOptions(previousLibraryFileOptions)
      setSelectedFileContextMode(previousFileContextMode)
      setDialogMessage(
        error instanceof Error && error.message.trim()
          ? error.message
          : 'No se pudo completar la consulta con la IA.',
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  return { submitMessage, cancelActiveReply }
}
