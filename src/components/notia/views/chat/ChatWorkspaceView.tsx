import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ArrowUp, Bot, FileImage, Files, Info, PanelLeftClose, PanelLeftOpen, Plus, Settings2, Sparkles, User2, X } from 'lucide-react'
import { NotiaButton } from '../../../common/NotiaButton'
import type { NotiaLibrary } from '../../../../types/notia'
import type { NetrunnerPreferences } from '../../../../services/preferences/netrunnerSettingsStorage'
import { CreateChatModal, type CreateChatModalSubmitPayload } from '../../CreateChatModal'
import { createChatDraftFile, deleteChatDraftFile } from '../../../../services/chat/chatSessionStorage'
import { useSubmenuEngine } from '../../../../hooks/useSubmenuEngine'
import { NotiaSubmenuPanel } from '../../NotiaSubmenuPanel'
import { useConfirmationEngine } from '../../../../context/confirmation/useConfirmationEngine'
import { AppDialogModal } from '../../AppDialogModal'
import {
  clearLongTermMemories,
  loadChatDocument,
  saveChatDocument,
  type StoredChatDocument,
  type StoredChatMessage,
} from '../../../../services/chat/chatDocumentStorage'
import { streamNetrunnerChatReply } from '../../../../services/netrunner/netrunnerChatRuntime'
import { resolveLongTermMemoryFilePath } from '../../../../services/chat/chatLibraryStructure'
import {
  buildAttachmentDisplayName,
  loadInlineFileAttachments,
  type ChatFileContextMode,
  type ChatLibraryFileOption,
} from '../../../../services/chat/chatAttachmentRuntime'
import { ChatLibraryFilesModal } from './ChatLibraryFilesModal'
import { ChatMarkdownMessage } from './ChatMarkdownMessage'

export interface ChatWorkspaceViewProps {
  library: NotiaLibrary | null
  netrunnerPreferences: NetrunnerPreferences
  previousChats?: Array<{
    id: string
    title: string
    filePath: string
  }>
  title?: string
  description?: string
  suggestions?: string[]
  showHistoryPanel?: boolean
  composerContextLabel?: string
  preferredContextPaths?: string[]
  preferredContextName?: string | null
  preferredContextMode?: ChatFileContextMode | null
  preferredContextScopeKey?: string | null
  transientContextPaths?: string[]
  transientContextMode?: ChatFileContextMode | null
  transientContextSummary?: string | null
  persistTransientContext?: boolean
  selectMatchingChatOnly?: boolean
  onChatCreated?: (filePath: string) => void | Promise<void>
  onChatDeleted?: (filePath: string) => void | Promise<void>
}

const DEFAULT_SUGGESTIONS = [
  'Resume estas notas',
  'Conecta ideas relacionadas',
  'Dame proximos pasos concretos',
]

function normalizeChatTitle(value: string): string {
  const trimmed = value.trim()
  return trimmed || 'Chat sin titulo'
}

function buildAutoCreateChatPayload(showHistoryPanel: boolean): CreateChatModalSubmitPayload {
  return {
    longTermMemoryEnabled: showHistoryPanel,
    contextMemoryEnabled: true,
    contextMemoryMessageCount: 10,
  }
}

interface SelectedImageAttachment {
  name: string
  mimeType: string
  base64: string
}

interface AttachmentMenuPosition {
  top: number
  left: number
}

function areStringArraysEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false
  }

  return left.every((value, index) => value === right[index])
}

function inferTaskManagerBoardPrefix(scopeKey: string | null, contextPaths: string[]): string | null {
  if (!scopeKey?.startsWith('task-manager:board:')) {
    return null
  }

  const firstPath = contextPaths[0]
  if (!firstPath) {
    return null
  }

  const normalizedPath = firstPath.replace(/\\/g, '/')
  const marker = '/task-mannager/'
  const markerIndex = normalizedPath.indexOf(marker)
  if (markerIndex < 0) {
    return null
  }

  const boardName = scopeKey.slice('task-manager:board:'.length).trim().toLowerCase()
  if (!boardName) {
    return null
  }

  return `${normalizedPath.slice(0, markerIndex)}${marker}${boardName}/`
}

function doesChatDocumentMatchPreferredContext(
  document: StoredChatDocument | null,
  preferredContextMode: ChatFileContextMode | null,
  preferredContextScopeKey: string | null,
  resolvedPreferredContextPaths: string[],
): boolean {
  if (!document) {
    return false
  }

  const matchesScopeKey = (document.contextScopeKey ?? null) === (preferredContextScopeKey ?? null)
  if (preferredContextMode && resolvedPreferredContextPaths.length > 0) {
    return document.selectedContextMode === preferredContextMode
      && areStringArraysEqual(document.selectedContextFiles, resolvedPreferredContextPaths)
      && matchesScopeKey
  }

  if (preferredContextScopeKey) {
    return matchesScopeKey
  }

  return false
}

function readImageFileAsAttachment(file: File): Promise<SelectedImageAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => {
      reject(new Error('No se pudo leer la imagen seleccionada.'))
    }
    reader.onload = () => {
      const rawResult = typeof reader.result === 'string' ? reader.result : ''
      const commaIndex = rawResult.indexOf(',')
      const base64 = commaIndex >= 0 ? rawResult.slice(commaIndex + 1) : rawResult
      if (!base64.trim()) {
        reject(new Error('No se pudo procesar la imagen seleccionada.'))
        return
      }

      resolve({
        name: file.name || 'imagen',
        mimeType: file.type || 'image/png',
        base64,
      })
    }
    reader.readAsDataURL(file)
  })
}

export function ChatWorkspaceView({
  library,
  netrunnerPreferences,
  previousChats = [],
  title = 'Notia Chat',
  description = 'Una vista de chat reutilizable para futuras integraciones.',
  suggestions = DEFAULT_SUGGESTIONS,
  showHistoryPanel = true,
  composerContextLabel,
  preferredContextPaths = [],
  preferredContextName = null,
  preferredContextMode = null,
  preferredContextScopeKey = null,
  transientContextPaths = [],
  transientContextMode = null,
  transientContextSummary = null,
  persistTransientContext = false,
  selectMatchingChatOnly = false,
  onChatCreated,
  onChatDeleted,
}: ChatWorkspaceViewProps) {
  const [locallyDeletedChatPaths, setLocallyDeletedChatPaths] = useState<string[]>([])
  const [pendingAutoCreatedChatFilePath, setPendingAutoCreatedChatFilePath] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isHistoryPanelOpen, setIsHistoryPanelOpen] = useState(true)
  const [isCreateChatModalOpen, setIsCreateChatModalOpen] = useState(false)
  const [createChatErrorMessage, setCreateChatErrorMessage] = useState<string | null>(null)
  const [isCreateChatSubmitting, setIsCreateChatSubmitting] = useState(false)
  const [dialogMessage, setDialogMessage] = useState<string | null>(null)
  const [isChatToolsModalOpen, setIsChatToolsModalOpen] = useState(false)
  const [selectedChatFilePath, setSelectedChatFilePath] = useState<string | null>(null)
  const [activeChatDocument, setActiveChatDocument] = useState<StoredChatDocument | null>(null)
  const [isChatLoading, setIsChatLoading] = useState(false)
  const [chatTitleOverrides, setChatTitleOverrides] = useState<Record<string, string>>({})
  const [streamingThinking, setStreamingThinking] = useState('')
  const [streamingAssistantMessage, setStreamingAssistantMessage] = useState('')
  const [optimisticThreadMessages, setOptimisticThreadMessages] = useState<StoredChatMessage[] | null>(null)
  const [isClearingLongTermMemory, setIsClearingLongTermMemory] = useState(false)
  const [isAttachmentMenuOpen, setIsAttachmentMenuOpen] = useState(false)
  const [attachmentMenuPosition, setAttachmentMenuPosition] = useState<AttachmentMenuPosition | null>(null)
  const [matchedPreferredChatFilePath, setMatchedPreferredChatFilePath] = useState<string | null>(null)
  const [isLibraryFilesModalOpen, setIsLibraryFilesModalOpen] = useState(false)
  const [selectedLibraryFilePaths, setSelectedLibraryFilePaths] = useState<string[]>([])
  const [selectedLibraryFileOptions, setSelectedLibraryFileOptions] = useState<ChatLibraryFileOption[]>([])
  const [selectedFileContextMode, setSelectedFileContextMode] = useState<ChatFileContextMode>('direct')
  const [selectedImageAttachment, setSelectedImageAttachment] = useState<SelectedImageAttachment | null>(null)
  const [chatContextMenuState, setChatContextMenuState] = useState<{
    chatId: string
    filePath: string
    title: string
    top: number
    left: number
  } | null>(null)
  const { confirm } = useConfirmationEngine()
  const imageInputRef = useRef<HTMLInputElement | null>(null)
  const { panelRef: chatContextMenuPanelRef } = useSubmenuEngine<HTMLButtonElement, HTMLDivElement>({
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

  const visibleSuggestions = useMemo(
    () => suggestions.filter((suggestion) => suggestion.trim().length > 0).slice(0, 4),
    [suggestions],
  )
  const availablePreviousChats = useMemo(
    () => previousChats.filter((chat) => !locallyDeletedChatPaths.includes(chat.filePath)),
    [locallyDeletedChatPaths, previousChats],
  )
  const resolvedPreviousChats = useMemo(
    () => availablePreviousChats.map((chat) => ({
      ...chat,
      title: normalizeChatTitle(chatTitleOverrides[chat.filePath] ?? chat.title),
    })),
    [availablePreviousChats, chatTitleOverrides],
  )
  const compactRecentChats = useMemo(() => resolvedPreviousChats.slice(0, 3), [resolvedPreviousChats])
  const selectedLibraryFileSummary = useMemo(
    () => selectedLibraryFileOptions.filter((option) => selectedLibraryFilePaths.includes(option.path)),
    [selectedLibraryFileOptions, selectedLibraryFilePaths],
  )
  const resolvedPreferredContextPaths = useMemo(
    () => preferredContextPaths.map((pathValue) => pathValue.trim()).filter(Boolean),
    [preferredContextPaths],
  )
  const resolvedTransientContextPaths = useMemo(
    () => transientContextPaths.map((pathValue) => pathValue.trim()).filter(Boolean),
    [transientContextPaths],
  )
  const hasTransientContext = transientContextMode !== null && resolvedTransientContextPaths.length > 0
  const preferredContextSignature = useMemo(
    () => [
      preferredContextMode ?? '',
      preferredContextScopeKey ?? '',
      resolvedPreferredContextPaths.join('\n'),
    ].join('::'),
    [preferredContextMode, preferredContextScopeKey, resolvedPreferredContextPaths],
  )
  const preferredTaskManagerBoardPrefix = useMemo(
    () => inferTaskManagerBoardPrefix(preferredContextScopeKey, resolvedPreferredContextPaths),
    [preferredContextScopeKey, resolvedPreferredContextPaths],
  )
  const preferredContextOption = useMemo(() => {
    if (resolvedPreferredContextPaths.length !== 1) {
      return null
    }

    const preferredContextPath = resolvedPreferredContextPaths[0]

    const normalizedLibraryPath = library?.path.replace(/[\\/]+$/, '') ?? ''
    const relativePath = normalizedLibraryPath
      && preferredContextPath.startsWith(`${normalizedLibraryPath}/`)
      ? preferredContextPath.slice(normalizedLibraryPath.length + 1)
      : preferredContextPath

    return {
      path: preferredContextPath,
      name: preferredContextName?.trim() || buildAttachmentDisplayName(preferredContextPath),
      relativePath,
    } satisfies ChatLibraryFileOption
  }, [library?.path, preferredContextName, resolvedPreferredContextPaths])
  const selectedChatFallbackTitle = useMemo(() => {
    if (!selectedChatFilePath) {
      return 'Chat'
    }

    const matchingChat = availablePreviousChats.find((chat) => chat.filePath === selectedChatFilePath)
    return normalizeChatTitle(matchingChat?.title ?? 'Chat')
  }, [availablePreviousChats, selectedChatFilePath])
  const effectiveSelectedContextPaths = hasTransientContext ? resolvedTransientContextPaths : selectedLibraryFilePaths
  const effectiveSelectedContextMode = hasTransientContext ? transientContextMode : selectedFileContextMode
  const transientContextSummaryLabel = hasTransientContext ? transientContextSummary?.trim() || null : null
  const displayedMessages = optimisticThreadMessages ?? activeChatDocument?.messages ?? []
  const hasMessages = displayedMessages.length > 0
  const canSubmit = draft.trim().length > 0 && !isSubmitting && Boolean(library)

  useEffect(() => {
    if (!selectMatchingChatOnly) {
      return
    }

    setSelectedChatFilePath(null)
    setActiveChatDocument(null)
    setOptimisticThreadMessages(null)
    setStreamingThinking('')
    setStreamingAssistantMessage('')
  }, [preferredContextSignature, selectMatchingChatOnly])

  useEffect(() => {
    if (pendingAutoCreatedChatFilePath && selectedChatFilePath === pendingAutoCreatedChatFilePath) {
      return
    }

    if (selectMatchingChatOnly) {
      if (
        !matchedPreferredChatFilePath
        && selectedChatFilePath
        && doesChatDocumentMatchPreferredContext(
          activeChatDocument,
          preferredContextMode,
          preferredContextScopeKey,
          resolvedPreferredContextPaths,
        )
      ) {
        return
      }

      setSelectedChatFilePath(matchedPreferredChatFilePath)
      return
    }

    if (resolvedPreferredContextPaths.length > 0 || preferredContextScopeKey) {
      if (
        !matchedPreferredChatFilePath
        && selectedChatFilePath
        && doesChatDocumentMatchPreferredContext(
          activeChatDocument,
          preferredContextMode,
          preferredContextScopeKey,
          resolvedPreferredContextPaths,
        )
      ) {
        return
      }

      setSelectedChatFilePath(matchedPreferredChatFilePath)
      return
    }

    if (selectedChatFilePath && availablePreviousChats.length === 0) {
      return
    }

    if (selectedChatFilePath && availablePreviousChats.some((chat) => chat.filePath === selectedChatFilePath)) {
      return
    }

    setSelectedChatFilePath(availablePreviousChats[0]?.filePath ?? null)
  }, [
    matchedPreferredChatFilePath,
    activeChatDocument,
    pendingAutoCreatedChatFilePath,
    preferredContextMode,
    preferredContextScopeKey,
    availablePreviousChats,
    resolvedPreferredContextPaths,
    selectMatchingChatOnly,
    selectedChatFilePath,
  ])

  useEffect(() => {
    if (!pendingAutoCreatedChatFilePath) {
      return
    }

    if (availablePreviousChats.some((chat) => chat.filePath === pendingAutoCreatedChatFilePath)) {
      setPendingAutoCreatedChatFilePath(null)
    }
  }, [availablePreviousChats, pendingAutoCreatedChatFilePath])

  useEffect(() => {
    if (availablePreviousChats.length === 0) {
      setChatTitleOverrides({})
      return
    }

    let cancelled = false
    void Promise.all(availablePreviousChats.map(async (chat) => {
      try {
        const document = await loadChatDocument(chat.filePath, chat.title)
        return [chat.filePath, normalizeChatTitle(document.title)] as const
      } catch {
        return [chat.filePath, normalizeChatTitle(chat.title)] as const
      }
    })).then((entries) => {
      if (cancelled) {
        return
      }

      setChatTitleOverrides(Object.fromEntries(entries))
    })

    return () => {
      cancelled = true
    }
  }, [availablePreviousChats])

  useEffect(() => {
    if (selectMatchingChatOnly) {
      setMatchedPreferredChatFilePath(null)
    }
  }, [
    preferredContextMode,
    preferredContextScopeKey,
    resolvedPreferredContextPaths,
    selectMatchingChatOnly,
  ])

  useEffect(() => {
    if (!preferredContextScopeKey && resolvedPreferredContextPaths.length === 0) {
      setMatchedPreferredChatFilePath(null)
      return
    }

    if (availablePreviousChats.length === 0) {
      setMatchedPreferredChatFilePath(null)
      return
    }

    let cancelled = false
    void Promise.all(availablePreviousChats.map(async (chat) => {
      try {
        const document = await loadChatDocument(chat.filePath, chat.title)
        const boardPrefix = preferredTaskManagerBoardPrefix
        const exactScopeMatch = Boolean(preferredContextScopeKey) && document.contextScopeKey === preferredContextScopeKey
        const exactPathsMatch = (
          Boolean(preferredContextMode)
          && resolvedPreferredContextPaths.length > 0
          && document.selectedContextMode === preferredContextMode
          && areStringArraysEqual(document.selectedContextFiles, resolvedPreferredContextPaths)
        )
        const boardFallbackMatch = (
          Boolean(boardPrefix)
          && Boolean(preferredContextMode)
          && document.selectedContextMode === preferredContextMode
          && document.selectedContextFiles.length > 0
          && document.selectedContextFiles.every((pathValue) => pathValue.replace(/\\/g, '/').startsWith(boardPrefix ?? ''))
        )

        const score = exactScopeMatch ? 3 : exactPathsMatch ? 2 : boardFallbackMatch ? 1 : 0
        return score > 0 ? { filePath: chat.filePath, score } : null
      } catch {
        return null
      }
    })).then((matches) => {
      if (cancelled) {
        return
      }

      const candidates = matches.filter((match): match is { filePath: string; score: number } => Boolean(match))
      if (candidates.length === 0) {
        setMatchedPreferredChatFilePath(null)
        return
      }

      const currentMatch = selectedChatFilePath
        ? candidates.find((candidate) => candidate.filePath === selectedChatFilePath)
        : null
      const bestScore = Math.max(...candidates.map((candidate) => candidate.score))

      if (currentMatch && currentMatch.score === bestScore) {
        setMatchedPreferredChatFilePath(currentMatch.filePath)
        return
      }

      setMatchedPreferredChatFilePath(
        candidates.find((candidate) => candidate.score === bestScore)?.filePath ?? null,
      )
    })

    return () => {
      cancelled = true
    }
  }, [
    preferredContextMode,
    preferredContextScopeKey,
    preferredTaskManagerBoardPrefix,
    availablePreviousChats,
    resolvedPreferredContextPaths,
    selectedChatFilePath,
  ])

  useEffect(() => {
    if (resolvedPreferredContextPaths.length === 0 || !preferredContextMode) {
      return
    }

    setSelectedLibraryFilePaths((current) => (
      areStringArraysEqual(current, resolvedPreferredContextPaths)
        ? current
        : resolvedPreferredContextPaths
    ))
    setSelectedFileContextMode((current) => (current === preferredContextMode ? current : preferredContextMode))
    setSelectedLibraryFileOptions((current) => {
      if (!preferredContextOption) {
        return current.length === 0 ? current : []
      }

      const nextOptions = current.filter((option) => option.path !== preferredContextOption.path)
      nextOptions.unshift(preferredContextOption)
      return nextOptions
    })
  }, [preferredContextMode, preferredContextOption, resolvedPreferredContextPaths])

  useLayoutEffect(() => {
    if (!isAttachmentMenuOpen) {
      setAttachmentMenuPosition(null)
      return
    }

    const trigger = attachmentMenuTriggerRef.current
    const panel = attachmentMenuPanelRef.current
    if (!trigger || !panel) {
      return
    }

    const margin = 8
    const gap = 8
    const triggerRect = trigger.getBoundingClientRect()
    const panelRect = panel.getBoundingClientRect()
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight

    const nextLeft = Math.min(
      Math.max(triggerRect.right - panelRect.width, margin),
      Math.max(margin, viewportWidth - panelRect.width - margin),
    )

    const topAboveTrigger = triggerRect.top - panelRect.height - gap
    const topBelowTrigger = triggerRect.bottom + gap
    const shouldOpenBelow = topAboveTrigger < margin && topBelowTrigger + panelRect.height <= viewportHeight - margin
    const nextTop = shouldOpenBelow
      ? topBelowTrigger
      : Math.max(margin, topAboveTrigger)

    setAttachmentMenuPosition((current) => {
      if (current?.top === nextTop && current.left === nextLeft) {
        return current
      }

      return {
        top: nextTop,
        left: nextLeft,
      }
    })
  }, [attachmentMenuPanelRef, attachmentMenuTriggerRef, isAttachmentMenuOpen])

  useEffect(() => {
    if (!selectedChatFilePath) {
      setActiveChatDocument(null)
      setOptimisticThreadMessages(null)
      setStreamingThinking('')
      setStreamingAssistantMessage('')
      setSelectedLibraryFilePaths(resolvedPreferredContextPaths)
      setSelectedLibraryFileOptions(preferredContextOption ? [preferredContextOption] : [])
      setSelectedFileContextMode(preferredContextMode ?? 'direct')
      return
    }

    if (isSubmitting) {
      return
    }

    let cancelled = false
    setIsChatLoading(true)
    void loadChatDocument(selectedChatFilePath, selectedChatFallbackTitle)
      .then((document) => {
        if (cancelled) {
          return
        }

        setActiveChatDocument(document)
        setStreamingThinking('')
        setStreamingAssistantMessage('')
        setChatTitleOverrides((current) => ({
          ...current,
          [selectedChatFilePath]: normalizeChatTitle(document.title),
        }))
      })
      .catch((error) => {
        if (cancelled) {
          return
        }

        setActiveChatDocument(null)
        setDialogMessage(
          error instanceof Error && error.message.trim()
            ? error.message
            : 'No se pudo cargar el chat seleccionado.',
        )
      })
      .finally(() => {
        if (!cancelled) {
          setIsChatLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [
    isSubmitting,
    preferredContextMode,
    preferredContextOption,
    resolvedPreferredContextPaths,
    selectedChatFallbackTitle,
    selectedChatFilePath,
  ])

  useEffect(() => {
    if (!activeChatDocument) {
      return
    }

    setSelectedLibraryFilePaths(activeChatDocument.selectedContextFiles)
    setSelectedLibraryFileOptions((current) => {
      if (
        preferredContextOption
        && preferredContextMode
        && activeChatDocument.selectedContextMode === preferredContextMode
        && activeChatDocument.selectedContextFiles.includes(preferredContextOption.path)
      ) {
        const nextOptions = current.filter((option) => option.path !== preferredContextOption.path)
        nextOptions.unshift(preferredContextOption)
        return nextOptions
      }

      return []
    })
    setSelectedFileContextMode(activeChatDocument.selectedContextMode)
  }, [activeChatDocument, preferredContextMode, preferredContextOption])

  useEffect(() => {
    if (
      (!preferredContextScopeKey && resolvedPreferredContextPaths.length === 0)
      || !activeChatDocument
      || !selectedChatFilePath
    ) {
      return
    }

    const hasExpectedContext =
      (activeChatDocument.contextScopeKey ?? null) === (preferredContextScopeKey ?? null)
      && (
        !preferredContextMode
        || resolvedPreferredContextPaths.length === 0
        || (
          activeChatDocument.selectedContextMode === preferredContextMode
          && areStringArraysEqual(activeChatDocument.selectedContextFiles, resolvedPreferredContextPaths)
        )
      )

    if (hasExpectedContext) {
      return
    }

    const nextDocument: StoredChatDocument = {
      ...activeChatDocument,
      contextScopeKey: preferredContextScopeKey,
      selectedContextMode: preferredContextMode ?? activeChatDocument.selectedContextMode,
      selectedContextFiles: preferredContextMode && resolvedPreferredContextPaths.length > 0
        ? resolvedPreferredContextPaths
        : activeChatDocument.selectedContextFiles,
    }

    setActiveChatDocument(nextDocument)

    void saveChatDocument(selectedChatFilePath, nextDocument).catch((error) => {
      setDialogMessage(
        error instanceof Error && error.message.trim()
          ? error.message
          : 'No se pudo guardar el contexto activo del chat.',
      )
    })
  }, [
    activeChatDocument,
    preferredContextMode,
    preferredContextScopeKey,
    resolvedPreferredContextPaths,
    selectedChatFilePath,
  ])

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
    if (!chatContextMenuState) {
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
      await deleteChatDraftFile(targetChat.filePath)
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

  const submitMessage = async (rawMessage: string) => {
    const trimmedMessage = rawMessage.trim()
    if (!trimmedMessage || isSubmitting || !library) {
      return
    }

    let targetChatDocument = activeChatDocument
    let targetChatFilePath = selectedChatFilePath

    if (!targetChatDocument || !targetChatFilePath) {
      try {
        const { filePath } = await createChatDraftFile(library, buildAutoCreateChatPayload(showHistoryPanel))
        setPendingAutoCreatedChatFilePath(filePath)
        await onChatCreated?.(filePath)
        const createdDocument = await loadChatDocument(filePath, 'Chat')
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
          await saveChatDocument(filePath, preparedDocument)
        }

        setSelectedChatFilePath(filePath)
        setMatchedPreferredChatFilePath(filePath)
        setActiveChatDocument(preparedDocument)
        setChatTitleOverrides((current) => ({
          ...current,
          [filePath]: normalizeChatTitle(preparedDocument.title),
        }))
        targetChatDocument = preparedDocument
        targetChatFilePath = filePath
      } catch (error) {
        setDialogMessage(
          error instanceof Error && error.message.trim()
            ? error.message
            : 'No se pudo crear el chat automáticamente.',
        )
        return
      }
    }

    const userMessage: StoredChatMessage = {
      role: 'user',
      content: trimmedMessage,
    }
    let inlineFileAttachments = [] as Awaited<ReturnType<typeof loadInlineFileAttachments>>
    const previousImageAttachment = selectedImageAttachment
    const previousLibraryFilePaths = selectedLibraryFilePaths
    const previousLibraryFileOptions = selectedLibraryFileOptions
    const previousFileContextMode = selectedFileContextMode

    try {
      inlineFileAttachments = await loadInlineFileAttachments(effectiveSelectedContextPaths, selectedLibraryFileOptions)
    } catch (error) {
      setDialogMessage(
        error instanceof Error && error.message.trim()
          ? error.message
          : 'No se pudieron preparar los archivos seleccionados.',
      )
      return
    }

    const previousMessages = targetChatDocument.messages
    const optimisticMessages = [...previousMessages, userMessage]
    const previousDraft = draft

    setDraft('')
    setIsSubmitting(true)
    setOptimisticThreadMessages(optimisticMessages)
    setIsAttachmentMenuOpen(false)
    setStreamingThinking('')
    setStreamingAssistantMessage('')
    setSelectedImageAttachment(null)
    setActiveChatDocument({
      ...targetChatDocument,
      contextScopeKey: preferredContextScopeKey ?? targetChatDocument.contextScopeKey,
      selectedContextFiles: hasTransientContext && !persistTransientContext
        ? targetChatDocument.selectedContextFiles
        : effectiveSelectedContextPaths,
      selectedContextMode: hasTransientContext && !persistTransientContext
        ? targetChatDocument.selectedContextMode
        : effectiveSelectedContextMode,
      messages: optimisticMessages,
    })

    try {
      await streamNetrunnerChatReply(
        netrunnerPreferences,
        trimmedMessage,
        [],
        [],
        {
          chatFilePath: targetChatFilePath,
          longTermMemoryFilePath: resolveLongTermMemoryFilePath(library.path),
        },
        {
          files: inlineFileAttachments,
          useLlamaIndex: effectiveSelectedContextMode === 'index',
          image: selectedImageAttachment,
          persistSelectedContext: !hasTransientContext || persistTransientContext,
        },
        {
          onThinkingDelta: (delta) => {
            setStreamingThinking((current) => current + delta)
          },
          onMessageDelta: (delta) => {
            setStreamingAssistantMessage((current) => current + delta)
          },
        },
      )

      const persistedDocument = await loadChatDocument(
        targetChatFilePath,
        targetChatDocument.title || 'Chat',
      )
      setActiveChatDocument(persistedDocument)
      setOptimisticThreadMessages(null)
      if (pendingAutoCreatedChatFilePath === targetChatFilePath) {
        setPendingAutoCreatedChatFilePath(null)
      }
      setStreamingThinking('')
      setStreamingAssistantMessage('')
      setChatTitleOverrides((current) => ({
        ...current,
        [targetChatFilePath]: normalizeChatTitle(persistedDocument.title),
      }))
    } catch (error) {
      if (pendingAutoCreatedChatFilePath === targetChatFilePath) {
        setPendingAutoCreatedChatFilePath(null)
      }
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
          : 'No se pudo completar la consulta con Netrunner.',
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="notia-main notia-chat-view">
      <section className="notia-chat-shell">
        <div className="notia-chat-layout">
          {showHistoryPanel ? (
            <aside
              className={`notia-chat-history-panel ${
                isHistoryPanelOpen ? 'notia-chat-history-panel--open' : 'notia-chat-history-panel--closed'
              }`}
            >
              <div className="notia-chat-history-header">
                <NotiaButton
                  variant="secondary"
                  className="notia-chat-history-toggle"
                  aria-label={isHistoryPanelOpen ? 'Ocultar panel de chats' : 'Mostrar panel de chats'}
                  title={isHistoryPanelOpen ? 'Ocultar panel de chats' : 'Mostrar panel de chats'}
                  onClick={() => {
                    setIsHistoryPanelOpen((current) => !current)
                  }}
                >
                  {isHistoryPanelOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
                </NotiaButton>
                {isHistoryPanelOpen ? (
                  <div className="notia-chat-history-actions">
                    <NotiaButton
                      variant="primary"
                      className="notia-chat-new-conversation"
                      onClick={() => {
                        setCreateChatErrorMessage(null)
                        setIsCreateChatModalOpen(true)
                      }}
                      disabled={!library}
                    >
                      <Plus size={16} />
                      Nuevo chat
                    </NotiaButton>
                    <NotiaButton
                      size="icon"
                      variant="secondary"
                      className="notia-chat-tools-button"
                      title="Herramientas del chat"
                      aria-label="Abrir herramientas del chat"
                      onClick={() => {
                        setIsChatToolsModalOpen(true)
                      }}
                      disabled={!library}
                    >
                      <Settings2 size={16} />
                    </NotiaButton>
                  </div>
                ) : null}
              </div>

              {isHistoryPanelOpen ? (
                <>
                  <div className="notia-chat-history-copy">
                    <strong>Chats previos</strong>
                    <span>
                      {resolvedPreviousChats.length > 0
                        ? `${resolvedPreviousChats.length} chat${resolvedPreviousChats.length === 1 ? '' : 's'} creado${resolvedPreviousChats.length === 1 ? '' : 's'}`
                        : 'Todavia no hay chats creados.'}
                    </span>
                  </div>
                  <div className="notia-chat-history-list" aria-label="Chats previos">
                    {resolvedPreviousChats.length > 0 ? resolvedPreviousChats.map((chat) => (
                      <button
                        key={chat.id}
                        type="button"
                        className={`notia-chat-history-item ${
                          selectedChatFilePath === chat.filePath ? 'notia-chat-history-item--active' : ''
                        }`}
                        title={chat.filePath}
                        onClick={() => {
                          setSelectedChatFilePath(chat.filePath)
                        }}
                        onContextMenu={(event) => {
                          event.preventDefault()
                          const panelWidth = 184
                          const nextLeft = Math.min(
                            Math.max(12, event.clientX),
                            window.innerWidth - panelWidth - 12,
                          )

                          setChatContextMenuState({
                            chatId: chat.id,
                            filePath: chat.filePath,
                            title: chat.title,
                            top: event.clientY,
                            left: nextLeft,
                          })
                        }}
                      >
                        <span>{chat.title}</span>
                        <small>{chat.filePath}</small>
                      </button>
                    )) : (
                      <div className="notia-chat-history-empty">No hay archivos de chat en `chat/chats`.</div>
                    )}
                  </div>
                </>
              ) : null}
            </aside>
          ) : null}

          <section className="notia-chat-main">
            {showHistoryPanel ? (
              <header className="notia-chat-header">
                <div className="notia-chat-header-copy">
                  <span className="notia-chat-kicker">
                    <Sparkles size={14} />
                    Workspace AI
                  </span>
                  <h2>{activeChatDocument?.title ?? title}</h2>
                  <p>{description}</p>
                </div>
                {visibleSuggestions.length > 0 ? (
                  <div className="notia-chat-suggestions" aria-label="Sugerencias de inicio">
                    {visibleSuggestions.map((suggestion) => (
                      <NotiaButton
                        key={suggestion}
                        variant="secondary"
                        className="notia-chat-suggestion"
                        onClick={() => {
                          setDraft(suggestion)
                        }}
                      >
                        {suggestion}
                      </NotiaButton>
                    ))}
                  </div>
                ) : null}
              </header>
            ) : (
              <header className="notia-chat-header notia-chat-header--compact">
                <div className="notia-chat-header-copy notia-chat-header-copy--compact">
                  <span className="notia-chat-title-subtle">{activeChatDocument?.title ?? title}</span>
                  <p>{description}</p>
                </div>
                {compactRecentChats.length > 0 ? (
                  <div className="notia-chat-compact-recent" aria-label="Chats recientes">
                    {compactRecentChats.map((chat) => (
                      <button
                        key={chat.id}
                        type="button"
                        className={`notia-chat-compact-recent-item ${
                          selectedChatFilePath === chat.filePath ? 'notia-chat-compact-recent-item--active' : ''
                        }`}
                        onClick={() => {
                          setSelectedChatFilePath(chat.filePath)
                        }}
                        title={chat.title}
                      >
                        {chat.title}
                      </button>
                    ))}
                  </div>
                ) : null}
              </header>
            )}

            <section className="notia-chat-thread" aria-live="polite">
              {hasMessages ? (
                <>
                  {displayedMessages.map((message, index) => (
                    <article
                      key={`${message.role}-${index}-${message.content.length}`}
                      className={`notia-chat-message notia-chat-message--${message.role}`}
                    >
                      <div className="notia-chat-message-avatar" aria-hidden="true">
                        {message.role === 'assistant' ? <Bot size={16} /> : <User2 size={16} />}
                      </div>
                      <div className="notia-chat-message-bubble">
                        <span className="notia-chat-message-role">
                          {message.role === 'assistant' ? 'Asistente' : 'Vos'}
                        </span>
                        <ChatMarkdownMessage source={message.content} />
                      </div>
                    </article>
                  ))}
                  {isSubmitting ? (
                    <>
                      <article className="notia-chat-message notia-chat-message--assistant">
                        <div className="notia-chat-message-avatar" aria-hidden="true">
                          <Bot size={16} />
                        </div>
                          <div className="notia-chat-message-bubble notia-chat-message-bubble--thinking">
                            <span className="notia-chat-message-role">Thinking</span>
                            {streamingThinking.trim() ? (
                            <ChatMarkdownMessage source={streamingThinking} />
                          ) : (
                            <div className="notia-chat-thinking" role="status" aria-label="Pensando">
                              <span />
                              <span />
                              <span />
                            </div>
                          )}
                        </div>
                      </article>
                      {streamingAssistantMessage.trim() ? (
                        <article className="notia-chat-message notia-chat-message--assistant">
                          <div className="notia-chat-message-avatar" aria-hidden="true">
                            <Bot size={16} />
                          </div>
                          <div className="notia-chat-message-bubble">
                            <span className="notia-chat-message-role">Asistente</span>
                            <ChatMarkdownMessage source={streamingAssistantMessage} />
                          </div>
                        </article>
                      ) : null}
                    </>
                  ) : null}
                </>
              ) : isChatLoading ? (
                <div className="notia-chat-empty">
                  <strong>Cargando chat...</strong>
                </div>
              ) : (
                <div className="notia-chat-empty">
                  <Bot size={18} />
                  <strong>{selectedChatFilePath ? 'Empeza una conversacion' : 'Selecciona o crea un chat'}</strong>
                  <p>
                    {selectedChatFilePath
                      ? 'Usa una sugerencia o escribi abajo para iniciar el chat con Netrunner.'
                      : showHistoryPanel
                        ? 'Escribí abajo para crear un chat automático o elegí uno existente para continuar.'
                        : 'Escribí abajo y el panel lateral crea un chat automático con la configuración rápida.'}
                  </p>
                </div>
              )}
            </section>

            <form
              className="notia-chat-composer"
              onSubmit={(event) => {
                event.preventDefault()
                void submitMessage(draft)
              }}
            >
              <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                className="notia-chat-image-input"
                onChange={(event) => {
                  const inputElement = event.currentTarget
                  const nextFile = event.target.files?.[0] ?? null
                  if (!nextFile) {
                    return
                  }

                  void readImageFileAsAttachment(nextFile)
                    .then((attachment) => {
                      setSelectedImageAttachment(attachment)
                    })
                    .catch((error) => {
                      setDialogMessage(
                        error instanceof Error && error.message.trim()
                          ? error.message
                          : 'No se pudo cargar la imagen seleccionada.',
                      )
                    })
                    .finally(() => {
                      inputElement.value = ''
                    })
                }}
              />
              {composerContextLabel ? (
                <div className="notia-chat-context-indicator" aria-live="polite">
                  <Info size={14} />
                  <span>{composerContextLabel}</span>
                </div>
              ) : null}
              {selectedImageAttachment || selectedLibraryFileSummary.length > 0 || transientContextSummaryLabel ? (
                <div className="notia-chat-attachments">
                  {selectedImageAttachment ? (
                    <div className="notia-chat-attachment-pill">
                      <FileImage size={14} />
                      <span>{selectedImageAttachment.name}</span>
                      <button
                        type="button"
                        aria-label="Quitar imagen"
                        onClick={() => {
                          setSelectedImageAttachment(null)
                        }}
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ) : null}
                  {transientContextSummaryLabel ? (
                    <div className="notia-chat-attachment-pill">
                      <Files size={14} />
                      <span>{transientContextSummaryLabel}</span>
                    </div>
                  ) : null}
                  {!hasTransientContext ? selectedLibraryFileSummary.map((fileOption) => (
                    <div key={fileOption.path} className="notia-chat-attachment-pill">
                      <Files size={14} />
                      <span>{fileOption.name}</span>
                      <button
                        type="button"
                        aria-label={`Quitar ${fileOption.name}`}
                        onClick={() => {
                          setSelectedLibraryFilePaths((current) => current.filter((path) => path !== fileOption.path))
                        }}
                      >
                        <X size={12} />
                      </button>
                    </div>
                  )) : null}
                  {!hasTransientContext ? selectedLibraryFilePaths
                    .filter((path) => !selectedLibraryFileSummary.some((option) => option.path === path))
                    .map((path) => (
                      <div key={path} className="notia-chat-attachment-pill">
                        <Files size={14} />
                        <span>{buildAttachmentDisplayName(path)}</span>
                        <button
                          type="button"
                          aria-label={`Quitar ${buildAttachmentDisplayName(path)}`}
                          onClick={() => {
                            setSelectedLibraryFilePaths((current) => current.filter((item) => item !== path))
                          }}
                        >
                          <X size={12} />
                        </button>
                      </div>
                    )) : null}
                  {effectiveSelectedContextPaths.length > 0 ? (
                    <div className="notia-chat-attachment-mode-badge">
                      {effectiveSelectedContextMode === 'index' ? 'Index' : 'Directo'}
                    </div>
                  ) : null}
                </div>
              ) : null}
              <label className="notia-chat-composer-field" aria-label="Escribir mensaje">
                <textarea
                  value={draft}
                  rows={1}
                  placeholder={library ? 'Escribi tu mensaje...' : 'Primero elegí una librería activa...'}
                  disabled={!library}
                  onChange={(event) => {
                    setDraft(event.target.value)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault()
                      void submitMessage(draft)
                    }
                  }}
                />
              </label>
              <div className="notia-chat-composer-footer">
                <span>Enter para enviar. Shift + Enter para salto de linea.</span>
                <div className="notia-chat-composer-actions">
                  <div className="notia-chat-attachment-menu-shell">
                    <NotiaButton
                      ref={attachmentMenuTriggerRef}
                      size="icon"
                      variant="secondary"
                      title="Adjuntar contexto"
                      aria-label="Adjuntar contexto"
                      onClick={() => {
                        if (!library) {
                          return
                        }
                        setIsAttachmentMenuOpen((current) => !current)
                      }}
                      disabled={!library || isSubmitting}
                    >
                      <Plus size={16} />
                    </NotiaButton>
                    {isAttachmentMenuOpen ? (
                      <NotiaSubmenuPanel
                        ref={attachmentMenuPanelRef}
                        className="notia-chat-attachment-menu"
                        style={attachmentMenuPosition
                          ? {
                            position: 'fixed',
                            top: `${attachmentMenuPosition.top}px`,
                            left: `${attachmentMenuPosition.left}px`,
                          }
                          : {
                            position: 'fixed',
                            top: '0',
                            left: '0',
                            visibility: 'hidden',
                          }}
                      >
                        <button
                          type="button"
                          className="notia-chat-attachment-menu-item"
                          onClick={() => {
                            setIsAttachmentMenuOpen(false)
                            imageInputRef.current?.click()
                          }}
                        >
                          <FileImage size={15} />
                          <span>Seleccionar imagen</span>
                        </button>
                        <button
                          type="button"
                          className="notia-chat-attachment-menu-item"
                          onClick={() => {
                            setIsAttachmentMenuOpen(false)
                            setIsLibraryFilesModalOpen(true)
                          }}
                        >
                          <Files size={15} />
                          <span>Buscar archivos de la librería</span>
                        </button>
                      </NotiaSubmenuPanel>
                    ) : null}
                  </div>
                  <NotiaButton type="submit" variant="primary" disabled={!canSubmit}>
                    Enviar
                    <ArrowUp size={16} />
                  </NotiaButton>
                </div>
              </div>
            </form>
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
          message="Administrá la memoria persistente compartida entre chats. Si borrás LongTermMemory, se vacía el archivo y Netrunner deja de usar esas memorias hasta que se vuelvan a generar."
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
