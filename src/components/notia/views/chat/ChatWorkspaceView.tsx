import { memo, useEffect, useLayoutEffect, useRef, useCallback, useState } from 'react'
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
import { writeAgentMemories } from '../../../../services/ai/agentPromptRuntime'
import { readChatFileAsAttachment } from './chatImageAttachment'
import { useChatState } from './useChatState'
import { useChatSubmitMessage } from './useChatSubmitMessage'
import { useChatAttachmentMenu } from './useChatAttachmentMenu'
import { notiaTimer } from '../../../../services/runtime/notiaLogger'
import {
  listAgentPrompts,
  loadSelectedAgentPromptFileName,
  saveSelectedAgentPromptFileName,
  type AgentPromptOption,
} from '../../../../services/ai/agentPromptRuntime'
import type { ChatWorkspaceViewProps } from './ChatWorkspaceViewTypes'
import type { TaskExecutionStep } from '../../../../services/chat/chatScopedAgentRuntime'
import type { AgentConfirmationDecision, AgentProgressEvent, MutationPreview } from '../../../../types/ai/agentContracts'
import { cancelPendingAgentPlanSteps, loadAgentExecutionPlan, resumeBlockedAgentPlan, retryFailedAgentPlan, saveAgentPlan } from '../../../../services/ai/agentPlanPersistence'
import {
  buildClarificationResumePrompt,
  canResumeClarification,
  clearClarificationRequest,
  loadClarificationRequest,
  saveClarificationRequest,
  type PersistedClarificationRequest,
} from '../../../../services/ai/clarificationPersistence'
import { useWorkspaceAiSnapshot } from '../../hooks/useWorkspaceAiSnapshot'
import { loadAutoApplyLowRiskPreference, shouldAutoApplyLowRiskPreview } from '../../../../services/ai/aiAutoApplyPreference'
import { listAiOperationHistory, type AiOperationHistoryEntry } from '../../../../services/ai/aiOperationHistory'
import { getAiOperation } from '../../../../services/ai/aiOperationJournal'
import { getMultiDocumentOperation } from '../../../../services/ai/aiMultiDocumentJournal'
import { getMultiDocumentPatchOperation } from '../../../../services/ai/aiMultiDocumentPatchJournal'
import type { AiOperationHistoryDiff } from './ChatThread'

const EMPTY_PREVIOUS_CHATS: Array<{ id: string; title: string; filePath: string }> = []
const EMPTY_CONTEXT_PATHS: string[] = []
const DEFAULT_SUGGESTIONS = [
  'Resume estas notas',
  'Conecta ideas relacionadas',
  'Dame proximos pasos concretos',
]

function isNaturalUndoRequest(value: string): boolean {
  const normalized = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  return /\b(undo|deshace|deshacer|deshacelo|volve atras|volver atras|reverti|revertir|revertelo)\b/.test(normalized)
}

export function ChatWorkspaceViewComponent({
  agentCorpusPaths = EMPTY_CONTEXT_PATHS,
  agentScope = null,
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
  transientContextDisplayPaths = EMPTY_CONTEXT_PATHS,
  onTransientContextPathRemove,
  persistTransientContext = false,
  selectMatchingChatOnly = false,
  historyHydrationMode = 'full',
  onChatCreated,
  onChatDeleted,
  markdownSelection = null,
  activeMarkdownSource = null,
  onActiveMarkdownDocumentChanged,
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
  const [agentPromptOptions, setAgentPromptOptions] = useState<AgentPromptOption[]>([
    { fileName: 'default.md', name: 'default' },
  ])
  const [agentPromptFileName, setAgentPromptFileName] = useState('default.md')
  const [pendingAgentQuestion, setPendingAgentQuestion] = useState<{
    question: string
    choices: string[]
  } | null>(null)
  const [pendingAgentAnswer, setPendingAgentAnswer] = useState<string | null>(null)
  const [pendingAgentConfirmation, setPendingAgentConfirmation] = useState<string | null>(null)
  const [pendingAgentPreview, setPendingAgentPreview] = useState<MutationPreview | null>(null)
  const [pendingAgentHunkIds, setPendingAgentHunkIds] = useState<string[]>([])
  const [agentExecutionPlan, setAgentExecutionPlan] = useState<TaskExecutionStep[]>(() => library ? loadAgentExecutionPlan(library.id) : [])
  const [awaitingAgentExecutionPlanApproval, setAwaitingAgentExecutionPlanApproval] = useState(false)
  const [lastAppliedOperationId, setLastAppliedOperationId] = useState<string | null>(null)
  const [aiOperationHistory, setAiOperationHistory] = useState<AiOperationHistoryEntry[]>(() => listAiOperationHistory())
  const [aiOperationDiff, setAiOperationDiff] = useState<AiOperationHistoryDiff | null>(null)
  const clarificationResolverRef = useRef<((answer: string) => void) | null>(null)
  const rehydratedClarificationRef = useRef<PersistedClarificationRequest | null>(null)
  const confirmationResolverRef = useRef<((decision: AgentConfirmationDecision) => void) | null>(null)
  const planApprovalResolverRef = useRef<((decision: { approved: boolean; suggestion?: string; steps?: TaskExecutionStep[] }) => void) | null>(null)
  const planHydrationPendingRef = useRef(false)
  const activeLibraryId = library?.id

  useEffect(() => {
    planHydrationPendingRef.current = true
    setAgentExecutionPlan(activeLibraryId ? loadAgentExecutionPlan(activeLibraryId) : [])
  }, [activeLibraryId])

  useEffect(() => {
    if (planHydrationPendingRef.current) {
      planHydrationPendingRef.current = false
      return
    }
    if (library) saveAgentPlan(library.id, agentExecutionPlan)
  }, [agentExecutionPlan, library])

  useEffect(() => {
    if (!library) {
      setAgentPromptOptions([{ fileName: 'default.md', name: 'default' }])
      setAgentPromptFileName('default.md')
      return
    }

    let isCurrent = true
    const refreshAgentPrompts = async () => {
      try {
        const options = await listAgentPrompts(library)
        if (!isCurrent) return
        const storedSelection = loadSelectedAgentPromptFileName(library.id)
        const selected = options.some((option) => option.fileName === storedSelection)
          ? storedSelection
          : 'default.md'
        setAgentPromptOptions(options)
        setAgentPromptFileName(selected)
        saveSelectedAgentPromptFileName(library.id, selected)
      } catch {
        if (!isCurrent) return
        setAgentPromptOptions([{ fileName: 'default.md', name: 'default' }])
        setAgentPromptFileName('default.md')
      }
    }

    void refreshAgentPrompts()
    window.addEventListener('focus', refreshAgentPrompts)
    return () => {
      isCurrent = false
      window.removeEventListener('focus', refreshAgentPrompts)
    }
  }, [agentScope, library])

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

  const hidesAttachedFileContext = agentScope === 'task-manager'
  const resolvedSelectedLibraryFilePaths = hidesAttachedFileContext ? EMPTY_CONTEXT_PATHS : selectedLibraryFilePaths
  const resolvedSelectedLibraryFileOptions = hidesAttachedFileContext ? [] : selectedLibraryFileOptions
  const resolvedEffectiveContextPaths = hidesAttachedFileContext ? EMPTY_CONTEXT_PATHS : effectiveSelectedContextPaths
  const resolvedSelectedLibraryFileSummary = hidesAttachedFileContext ? [] : selectedLibraryFileSummary
  const workspaceSnapshot = useWorkspaceAiSnapshot({
    scope: agentScope,
    activeMarkdownSource,
    markdownSelection,
  })
  const activeDocumentPath = workspaceSnapshot?.activeDocument?.path ?? null

  useEffect(() => {
    setAiOperationHistory(listAiOperationHistory())
    setAiOperationDiff(null)
  }, [activeDocumentPath, activeLibraryId])

  useEffect(() => {
    if (!library) {
      rehydratedClarificationRef.current = null
      return
    }

    const persisted = loadClarificationRequest(library.id)
    const context = {
      libraryId: library.id,
      scope: agentScope ?? 'library',
      documentPath: workspaceSnapshot?.activeDocument?.path ?? null,
      revision: workspaceSnapshot?.activeDocumentRevision ?? null,
    }
    // Wait for the active tab to hydrate before deciding that a document-scoped
    // clarification is stale; otherwise a WebView restart could erase it during
    // the transient `activeDocument === null` render.
    if (persisted?.documentPath && !context.documentPath) return
    if (!persisted || !canResumeClarification(persisted, context)) {
      if (persisted) clearClarificationRequest(library.id)
      rehydratedClarificationRef.current = null
      if (!clarificationResolverRef.current) setPendingAgentQuestion(null)
      return
    }

    rehydratedClarificationRef.current = persisted
    if (!clarificationResolverRef.current) {
      setPendingAgentQuestion({ question: persisted.question, choices: persisted.choices })
      setPendingAgentAnswer(null)
    }
  }, [agentScope, library, workspaceSnapshot?.activeDocument?.path, workspaceSnapshot?.activeDocumentRevision])

  useEffect(() => {
    if (!hidesAttachedFileContext) {
      return
    }

    setSelectedLibraryFilePaths((current) => current.length > 0 ? [] : current)
    setSelectedLibraryFileOptions((current) => current.length > 0 ? [] : current)
    setSelectedFileContextMode((current) => current === 'index' ? current : 'index')
  }, [
    hidesAttachedFileContext,
    selectedFileContextMode,
    selectedLibraryFileOptions.length,
    selectedLibraryFilePaths.length,
    setSelectedFileContextMode,
    setSelectedLibraryFileOptions,
    setSelectedLibraryFilePaths,
  ])

  useEffect(() => {
    if (!isSubmitting) {
      setPendingAgentAnswer(null)
    }
  }, [isSubmitting])

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
  }, [
    displayedMessages.length,
    agentExecutionPlan,
    isSubmitting,
    pendingAgentConfirmation,
    pendingAgentQuestion,
    streamingAssistantMessage,
    streamingThinking,
  ])

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
      agentCorpusPaths,
      agentScope,
      agentPromptFileName,
      requestAgentClarification: (question, signal, choices = []) => new Promise<string>((resolve, reject) => {
        const handleAbort = () => {
          clarificationResolverRef.current = null
          setPendingAgentQuestion(null)
          if (library) clearClarificationRequest(library.id)
          reject(new Error('Se canceló la aclaración solicitada por el agente.'))
        }
        signal.addEventListener('abort', handleAbort, { once: true })
        clarificationResolverRef.current = (answer) => {
          signal.removeEventListener('abort', handleAbort)
          clarificationResolverRef.current = null
          setPendingAgentQuestion(null)
          if (library) clearClarificationRequest(library.id)
          resolve(answer)
        }
        rehydratedClarificationRef.current = null
        setPendingAgentAnswer(null)
        setPendingAgentQuestion({ question, choices })
        if (library) {
          saveClarificationRequest({
            version: 1,
            requestId: `clarification-${Date.now()}`,
            libraryId: library.id,
            question,
            choices,
            scope: agentScope ?? 'library',
            documentPath: workspaceSnapshot?.activeDocument?.path ?? null,
            revision: workspaceSnapshot?.activeDocumentRevision ?? null,
            createdAt: Date.now(),
            expiresAt: Date.now() + 15 * 60_000,
          })
        }
        setStreamingThinking('')
        setStreamingAssistantMessage('')
      }),
      requestAgentConfirmation: (question, signal, preview) => new Promise<boolean | AgentConfirmationDecision>((resolve, reject) => {
        const autoApplyPreview = preview
        if (library && autoApplyPreview && shouldAutoApplyLowRiskPreview(autoApplyPreview, loadAutoApplyLowRiskPreference(library.id))) {
          resolve({ accepted: true, hunkIds: autoApplyPreview.hunks.map((hunk) => hunk.id) })
          return
        }
        const handleAbort = () => {
          confirmationResolverRef.current = null
          setPendingAgentConfirmation(null)
          setPendingAgentPreview(null)
          setPendingAgentHunkIds([])
          reject(new Error('Se canceló la confirmación solicitada por el agente.'))
        }
        signal.addEventListener('abort', handleAbort, { once: true })
        confirmationResolverRef.current = (decision) => {
          signal.removeEventListener('abort', handleAbort)
          confirmationResolverRef.current = null
          setPendingAgentConfirmation(null)
          setPendingAgentPreview(null)
          setPendingAgentHunkIds([])
          window.setTimeout(() => chatThreadRef.current?.focus(), 0)
          resolve(preview ? decision : decision.accepted)
        }
        setPendingAgentConfirmation(question)
        setPendingAgentPreview(preview ?? null)
        setPendingAgentHunkIds(preview?.hunks.filter((hunk) => hunk.status !== 'rejected').map((hunk) => hunk.id) ?? [])
        setStreamingThinking('')
        setStreamingAssistantMessage('')
      }),
      agentExecutionPlan,
      onAgentExecutionPlanChange: setAgentExecutionPlan,
      onAgentProgress: (event: AgentProgressEvent) => {
        if (event.type === 'phase-changed' && event.phase === 'preparing') {
          setLastAppliedOperationId(null)
          return
        }
        if (agentScope !== 'document' || event.type !== 'tool-completed' || !event.ok || !event.changed || !event.operationId) return
        if (event.toolName === 'undo_ai_operation') {
          setLastAppliedOperationId(null)
          setAiOperationHistory(listAiOperationHistory())
          return
        }
        setLastAppliedOperationId(event.operationId)
        setAiOperationHistory(listAiOperationHistory())
      },
      requestAgentExecutionPlanApproval: (_steps, signal) => new Promise((resolve, reject) => {
        const handleAbort = () => {
          planApprovalResolverRef.current = null
          clarificationResolverRef.current = null
          setAwaitingAgentExecutionPlanApproval(false)
          setPendingAgentQuestion(null)
          reject(new Error('Se canceló la aprobación del plan del agente.'))
        }
        signal.addEventListener('abort', handleAbort, { once: true })
        planApprovalResolverRef.current = (decision) => {
          signal.removeEventListener('abort', handleAbort)
          planApprovalResolverRef.current = null
          setAwaitingAgentExecutionPlanApproval(false)
          resolve(decision)
        }
        setAwaitingAgentExecutionPlanApproval(true)
        setStreamingThinking('')
        setStreamingAssistantMessage('')
      }),
      library,
      aiPreferences,
      activeChatDocument,
      selectedChatFilePath,
      effectiveSelectedContextPaths: resolvedEffectiveContextPaths,
      effectiveSelectedContextMode,
      selectedLibraryFilePaths: resolvedSelectedLibraryFilePaths,
      selectedLibraryFileOptions: resolvedSelectedLibraryFileOptions,
      selectedImageAttachment,
      selectedFileContextMode,
      showHistoryPanel,
      preferredContextScopeKey,
      persistTransientContext,
      hasTransientContext,
      onChatCreated,
      markdownSelection,
      activeMarkdownSource,
      workspaceSnapshot,
      onActiveMarkdownDocumentChanged,
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

  const submitComposerMessage = (message: string): Promise<void> => {
    const operationId = lastAppliedOperationId && isNaturalUndoRequest(message)
      ? lastAppliedOperationId
      : undefined
    if (operationId) setLastAppliedOperationId(null)
    return submitMessage(message, undefined, operationId)
  }

  const consumeRehydratedClarification = (answer: string): string | null => {
    const request = rehydratedClarificationRef.current
    if (!request) return null
    rehydratedClarificationRef.current = null
    clearClarificationRequest(request.libraryId)
    return buildClarificationResumePrompt(request, answer)
  }

  const handleResumeAgentExecutionPlan = () => {
    if (isSubmitting || agentExecutionPlan.length === 0) return
    const resumed = resumeBlockedAgentPlan(agentExecutionPlan)
    const nextPlan = resumed?.steps ?? agentExecutionPlan
    if (resumed) setAgentExecutionPlan(nextPlan)
    void submitMessage('Continuá con el TO-DO aprobado.', resumed ? nextPlan : undefined)
  }

  const handleRetryAgentExecutionPlan = () => {
    if (isSubmitting) return
    const retry = retryFailedAgentPlan(agentExecutionPlan)
    if (!retry) return
    setAgentExecutionPlan(retry.steps)
    void submitMessage(`Reintentá únicamente el paso fallido "${retry.stepId}" y continuá con el TO-DO aprobado.`, retry.steps)
  }

  const handleCancelAgentExecutionPlan = () => {
    if (isSubmitting) {
      cancelActiveReply()
    }
    setAwaitingAgentExecutionPlanApproval(false)
    setAgentExecutionPlan((current) => cancelPendingAgentPlanSteps(current))
  }

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
      title: 'Borrar memoria persistente',
      message: 'Se va a vaciar la memoria persistente del agente. Una vez hecho, no hay vuelta atrás. ¿Querés continuar?',
      confirmLabel: 'Borrar memoria',
      cancelLabel: 'Cancelar',
      tone: 'danger',
    })

    if (!accepted) {
      return
    }

    setIsClearingLongTermMemory(true)

    try {
      await writeAgentMemories(library, [])
      setIsChatToolsModalOpen(false)
    } catch (error) {
      setDialogMessage(
        error instanceof Error && error.message.trim()
          ? error.message
          : 'No se pudo vaciar la memoria persistente del agente.',
      )
    } finally {
      setIsClearingLongTermMemory(false)
    }
  }

  useEffect(() => {
    const key = 'onChatFileSelected'
    const windowProxy = window as unknown as { [key]?: (file: File) => Promise<void> }
    windowProxy[key] = async (file: File) => {
      try {
        const attachment = await readChatFileAsAttachment(file)
        setSelectedImageAttachment(attachment)
      } catch (error) {
        setDialogMessage(
          error instanceof Error && error.message.trim()
            ? error.message
            : 'No se pudo cargar el archivo seleccionado.',
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

  const handleViewAiOperationDiff = (operationId: string): void => {
    const markdownOperation = getAiOperation(operationId)
    if (markdownOperation) {
      setAiOperationDiff({
        operationId,
        summary: markdownOperation.summary,
        files: [{
          path: markdownOperation.documentPath,
          previousSource: markdownOperation.previousSource,
          nextSource: markdownOperation.nextSource,
        }],
      })
      return
    }

    const multiDocumentOperation = getMultiDocumentOperation(operationId)
    if (multiDocumentOperation) {
      setAiOperationDiff({ operationId, summary: multiDocumentOperation.summary, files: multiDocumentOperation.files })
      return
    }

    const multiDocumentPatchOperation = getMultiDocumentPatchOperation(operationId)
    if (multiDocumentPatchOperation) {
      setAiOperationDiff({ operationId, summary: multiDocumentPatchOperation.summary, files: multiDocumentPatchOperation.files })
      return
    }

    setDialogMessage('El diff detallado ya no está disponible en esta sesión, pero el historial conserva su metadata.')
  }

  const lastAssistantMessage = pendingAgentConfirmation
    ?? (awaitingAgentExecutionPlanApproval ? 'Preparé un plan de ejecución. ¿Querés aprobarlo?' : null)
    ?? pendingAgentQuestion?.question
    ?? [...displayedMessages].reverse().find((message) => message.role === 'assistant')?.content
    ?? null

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
            {!showHistoryPanel && agentScope ? (
              <label className="notia-chat-agent-select">
                <span>Agente</span>
                <select
                  value={agentPromptFileName}
                  disabled={isSubmitting}
                  onChange={(event) => {
                    const nextFileName = event.target.value
                    setAgentPromptFileName(nextFileName)
                    if (library) {
                      saveSelectedAgentPromptFileName(library.id, nextFileName)
                    }
                  }}
                >
                  {agentPromptOptions.map((option) => (
                    <option key={option.fileName} value={option.fileName}>{option.name}</option>
                  ))}
                </select>
              </label>
            ) : null}
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
              pendingAgentQuestion={pendingAgentQuestion}
              pendingAgentAnswer={pendingAgentAnswer}
              pendingAgentConfirmation={pendingAgentConfirmation}
              pendingAgentPreview={pendingAgentPreview}
              pendingAgentHunkIds={pendingAgentHunkIds}
              agentExecutionPlan={agentExecutionPlan}
              awaitingAgentExecutionPlanApproval={awaitingAgentExecutionPlanApproval}
              onApproveAgentExecutionPlan={(steps) => planApprovalResolverRef.current?.({ approved: true, steps })}
              onSuggestAgentExecutionPlanChanges={() => {
                const planResolver = planApprovalResolverRef.current
                if (!planResolver) return
                setAwaitingAgentExecutionPlanApproval(false)
                setPendingAgentQuestion({ question: '¿Qué cambios querés hacerle al TO-DO?', choices: [] })
                clarificationResolverRef.current = (suggestion) => {
                  clarificationResolverRef.current = null
                  setPendingAgentQuestion(null)
                  planResolver({ approved: false, suggestion })
                }
              }}
              onResumeAgentExecutionPlan={handleResumeAgentExecutionPlan}
              onRetryAgentExecutionPlan={handleRetryAgentExecutionPlan}
              onCancelAgentExecutionPlan={handleCancelAgentExecutionPlan}
              lastAppliedOperationId={lastAppliedOperationId}
              aiOperationHistory={activeDocumentPath
                ? aiOperationHistory.filter((entry) => entry.documentPath === activeDocumentPath)
                : []}
              aiOperationDiff={aiOperationDiff}
              onViewAiOperationDiff={handleViewAiOperationDiff}
              onCloseAiOperationDiff={() => setAiOperationDiff(null)}
              onUndoAiOperation={(operationId) => {
                if (isSubmitting) return
                setLastAppliedOperationId(null)
                void submitMessage('VolvÃ© atrÃ¡s el cambio de IA seleccionado.', undefined, operationId)
              }}
              onUndoLastAiOperation={() => {
                if (!lastAppliedOperationId || isSubmitting) return
                const operationId = lastAppliedOperationId
                setLastAppliedOperationId(null)
                void submitMessage('Volvé atrás el último cambio de IA.', undefined, operationId)
              }}
              onConfirmAgentAction={() => confirmationResolverRef.current?.({ accepted: true, hunkIds: pendingAgentHunkIds })}
              onDeclineAgentAction={() => confirmationResolverRef.current?.({ accepted: false })}
              onEditAgentProposal={() => {
                confirmationResolverRef.current?.({ accepted: false })
                setDialogMessage('La propuesta se canceló. Indicame qué querés cambiar y preparo un nuevo preview.')
              }}
              onToggleAgentHunk={(hunkId) => {
                setPendingAgentHunkIds((current) => current.includes(hunkId)
                  ? current.filter((id) => id !== hunkId)
                  : [...current, hunkId])
              }}
              onSelectAgentClarificationOption={(choice) => {
                const resolver = clarificationResolverRef.current
                if (!resolver) {
                  const resumePrompt = consumeRehydratedClarification(choice)
                  if (!resumePrompt) {
                    setPendingAgentQuestion(null)
                    setPendingAgentAnswer('Cancelada')
                    return
                  }
                  setPendingAgentAnswer(choice)
                  setPendingAgentQuestion(null)
                  void submitMessage(resumePrompt)
                  return
                }
                setPendingAgentAnswer(choice)
                setPendingAgentQuestion(null)
                resolver(choice)
              }}
              threadRef={chatThreadRef}
              onOpenAiSettings={handleOpenAiSettings}
            />

            <ChatComposer
              draft={draft}
              setDraft={setDraft}
              canSubmit={canSubmit}
              isSubmitting={isSubmitting}
              awaitingAgentClarification={Boolean(pendingAgentQuestion && clarificationResolverRef.current)}
              isAiAvailable={isAiAvailable}
              library={library}
              composerContextLabel={composerContextLabel}
              activeModelLabel={resolvedActiveModel}
              selectedImageAttachment={selectedImageAttachment}
              selectedLibraryFileSummary={resolvedSelectedLibraryFileSummary}
              selectedLibraryFilePaths={resolvedSelectedLibraryFilePaths}
              effectiveSelectedContextPaths={resolvedEffectiveContextPaths}
              effectiveSelectedContextMode={effectiveSelectedContextMode}
              transientContextSummaryLabel={transientContextSummaryLabel}
              transientContextDisplayPaths={transientContextDisplayPaths}
              hasTransientContext={hasTransientContext}
              isAttachmentMenuOpen={isAttachmentMenuOpen}
              attachmentMenuPosition={attachmentMenuPosition}
              onRemoveImage={() => {
                setSelectedImageAttachment(null)
              }}
              onRemoveFile={handleRemoveSelectedFile}
              onTransientContextPathRemove={onTransientContextPathRemove}
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
                  const clarificationResolver = clarificationResolverRef.current
                  if (clarificationResolver) {
                  const answer = draft.trim()
                  if (!answer) return
                  setPendingAgentAnswer(answer)
                  setDraft('')
                    clarificationResolver(answer)
                    return
                  }
                  if (rehydratedClarificationRef.current) {
                    const answer = draft.trim()
                    if (!answer) return
                    const resumePrompt = consumeRehydratedClarification(answer)
                    setPendingAgentAnswer(answer)
                    setPendingAgentQuestion(null)
                    setDraft('')
                    if (resumePrompt) void submitMessage(resumePrompt)
                    return
                  }
                  setPendingAgentAnswer(null)
                  void submitComposerMessage(draft)
              }}
              onSubmitText={(text) => {
                const normalizedVoiceAnswer = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()
                if (confirmationResolverRef.current && /^(si|confirmo|acepto|confirmar)\b/.test(normalizedVoiceAnswer)) {
                  confirmationResolverRef.current({ accepted: true, hunkIds: pendingAgentHunkIds })
                  return Promise.resolve()
                }
                if (confirmationResolverRef.current && /^(no|cancelo|rechazo|cancelar)\b/.test(normalizedVoiceAnswer)) {
                  confirmationResolverRef.current({ accepted: false })
                  return Promise.resolve()
                }
                if (planApprovalResolverRef.current && awaitingAgentExecutionPlanApproval && /^(si|apruebo|acepto|confirmo)\b/.test(normalizedVoiceAnswer)) {
                  planApprovalResolverRef.current({ approved: true })
                  return Promise.resolve()
                }
                const clarificationResolver = clarificationResolverRef.current
                if (clarificationResolver) {
                  setPendingAgentAnswer(text)
                  setPendingAgentQuestion(null)
                  clarificationResolver(text)
                  return Promise.resolve()
                }
                if (rehydratedClarificationRef.current) {
                  const resumePrompt = consumeRehydratedClarification(text)
                  setPendingAgentAnswer(text)
                  setPendingAgentQuestion(null)
                  return resumePrompt ? submitMessage(resumePrompt) : Promise.resolve()
                }
                setPendingAgentAnswer(null)
                return submitComposerMessage(text)
              }}
              lastAssistantMessage={lastAssistantMessage}
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
          message="Administrá la memoria persistente compartida entre chats. Si la borrás, la IA deja de usar esas memorias hasta que vuelvas a completarla."
          confirmLabel={isClearingLongTermMemory ? 'Borrando...' : 'Borrar memoria'}
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

function areMarkdownSelectionsEqual(
  left: ChatWorkspaceViewProps['markdownSelection'],
  right: ChatWorkspaceViewProps['markdownSelection'],
): boolean {
  if (left === right) return true
  if (!left || !right) return false
  return left.documentPath === right.documentPath
    && left.from === right.from
    && left.to === right.to
    && left.selectedText === right.selectedText
    && left.blocks.length === right.blocks.length
    && left.blocks.every((block, index) => {
      const other = right.blocks[index]
      return Boolean(other)
        && block.index === other.index
        && block.type === other.type
        && block.text === other.text
        && block.from === other.from
        && block.to === other.to
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

  if (previous.agentScope !== next.agentScope) {
    return false
  }

  if (!areStringArraysEqual(previous.agentCorpusPaths ?? EMPTY_CONTEXT_PATHS, next.agentCorpusPaths ?? EMPTY_CONTEXT_PATHS)) {
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

  if (!areStringArraysEqual(previous.transientContextDisplayPaths ?? EMPTY_CONTEXT_PATHS, next.transientContextDisplayPaths ?? EMPTY_CONTEXT_PATHS)) {
    return false
  }

  if (previous.onTransientContextPathRemove !== next.onTransientContextPathRemove) {
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

  if (previous.onActiveMarkdownDocumentChanged !== next.onActiveMarkdownDocumentChanged) {
    return false
  }

  if (!areMarkdownSelectionsEqual(previous.markdownSelection, next.markdownSelection)) {
    return false
  }

  if (previous.activeMarkdownSource !== next.activeMarkdownSource) {
    return false
  }

  return true
}

export const ChatWorkspaceView = memo(ChatWorkspaceViewComponent, areChatWorkspaceViewPropsEqual)
ChatWorkspaceView.displayName = 'ChatWorkspaceView'
