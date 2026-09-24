import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import type { StoredChatDocument, StoredChatMessage } from '../../../../services/chat/chatDocumentStorage'
import { loadChatDocument, matchChat, setChatViewContext } from '../../../../services/chat/chatDocumentStorage'
import { checkAiHealth, resolveActiveModel } from '../../../../services/ai/aiRuntime'
import { useVirtualList } from '../../../../hooks/useVirtualList'
import {
  buildAttachmentDisplayName,
  type ChatFileContextMode,
  type ChatLibraryFileOption,
} from '../../../../services/chat/chatAttachmentRuntime'
import type {
  ChatStarter,
  ChatWorkspaceViewProps,
  SelectedImageAttachment,
} from './ChatWorkspaceViewTypes'

const EMPTY_PREVIOUS_CHATS: Array<{ id: string; title: string; filePath: string }> = []
const EMPTY_CONTEXT_PATHS: string[] = []
const CHAT_HISTORY_ITEM_HEIGHT = 60
/** Below this width the chat history floats over the conversation instead of sitting beside it. */
export const CHAT_HISTORY_DOCKED_QUERY = '(min-width: 981px)'

export function normalizeChatTitle(value: string): string {
  const trimmed = value.trim()
  return trimmed || 'Chat sin titulo'
}

export function buildAutoCreateChatPayload(agentMemoryEnabled: boolean): {
  agentMemoryEnabled: boolean
  contextMemoryEnabled: boolean
  contextMemoryMessageCount: number
} {
  return {
    agentMemoryEnabled,
    contextMemoryEnabled: true,
    contextMemoryMessageCount: 10,
  }
}

export function areStringArraysEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false
  }

  return left.every((value, index) => value === right[index])
}

export function areChatLibraryFileOptionsEqual(
  left: ChatLibraryFileOption[],
  right: ChatLibraryFileOption[],
): boolean {
  if (left.length !== right.length) {
    return false
  }

  return left.every((option, index) => {
    const candidate = right[index]
    return Boolean(candidate)
      && option.path === candidate.path
      && option.name === candidate.name
      && option.relativePath === candidate.relativePath
  })
}

export function areChatTitleOverrideMapsEqual(
  left: Record<string, string>,
  right: Record<string, string>,
): boolean {
  const leftEntries = Object.entries(left)
  const rightEntries = Object.entries(right)
  if (leftEntries.length !== rightEntries.length) {
    return false
  }

  return leftEntries.every(([key, value]) => right[key] === value)
}

export function arePreviousChatArraysEqual(
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

/** Whether two lists name the same explorer paths, in any order. */
export function areSameContextPaths(left: string[], right: string[]): boolean {
  const normalize = (paths: string[]) => paths.map((path) => path.trim()).filter(Boolean).sort()
  return areStringArraysEqual(normalize(left), normalize(right))
}

export function doesChatDocumentMatchPreferredContext(
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
      && areSameContextPaths(document.selectedContextFiles, resolvedPreferredContextPaths)
      && matchesScopeKey
  }

  if (preferredContextScopeKey) {
    return matchesScopeKey
  }

  return false
}

export interface UseChatStateResult {
  // Chat selection
  selectedChatFilePath: string | null
  setSelectedChatFilePath: React.Dispatch<React.SetStateAction<string | null>>
  activeChatDocument: StoredChatDocument | null
  setActiveChatDocument: React.Dispatch<React.SetStateAction<StoredChatDocument | null>>
  isChatLoading: boolean
  chatTitleOverrides: Record<string, string>
  setChatTitleOverrides: React.Dispatch<React.SetStateAction<Record<string, string>>>
  selectedChatFallbackTitle: string
  matchedPreferredChatFilePath: string | null
  setMatchedPreferredChatFilePath: React.Dispatch<React.SetStateAction<string | null>>
  pendingAutoCreatedChatFilePath: string | null
  setPendingAutoCreatedChatFilePath: React.Dispatch<React.SetStateAction<string | null>>

  // Composer
  draft: string
  setDraft: React.Dispatch<React.SetStateAction<string>>
  isSubmitting: boolean
  setIsSubmitting: React.Dispatch<React.SetStateAction<boolean>>

  // UI panels
  isHistoryPanelOpen: boolean
  setIsHistoryPanelOpen: React.Dispatch<React.SetStateAction<boolean>>
  isCreateChatModalOpen: boolean
  setIsCreateChatModalOpen: React.Dispatch<React.SetStateAction<boolean>>
  createChatErrorMessage: string | null
  setCreateChatErrorMessage: React.Dispatch<React.SetStateAction<string | null>>
  isCreateChatSubmitting: boolean
  setIsCreateChatSubmitting: React.Dispatch<React.SetStateAction<boolean>>
  dialogMessage: string | null
  setDialogMessage: React.Dispatch<React.SetStateAction<string | null>>
  isChatToolsModalOpen: boolean
  setIsChatToolsModalOpen: React.Dispatch<React.SetStateAction<boolean>>
  isLibraryFilesModalOpen: boolean
  setIsLibraryFilesModalOpen: React.Dispatch<React.SetStateAction<boolean>>
  isClearingAgentMemory: boolean
  setIsClearingAgentMemory: React.Dispatch<React.SetStateAction<boolean>>
  chatContextMenuState: {
    chatId: string
    filePath: string
    title: string
    top: number
    left: number
  } | null
  setChatContextMenuState: React.Dispatch<React.SetStateAction<{
    chatId: string
    filePath: string
    title: string
    top: number
    left: number
  } | null>>
  locallyDeletedChatPaths: string[]
  setLocallyDeletedChatPaths: React.Dispatch<React.SetStateAction<string[]>>

  // Attachments
  isAttachmentMenuOpen: boolean
  setIsAttachmentMenuOpen: React.Dispatch<React.SetStateAction<boolean>>
  attachmentMenuPosition: { top: number; left: number } | null
  setAttachmentMenuPosition: React.Dispatch<React.SetStateAction<{ top: number; left: number } | null>>
  selectedImageAttachments: SelectedImageAttachment[]
  setSelectedImageAttachments: React.Dispatch<React.SetStateAction<SelectedImageAttachment[]>>
  selectedLibraryFilePaths: string[]
  setSelectedLibraryFilePaths: React.Dispatch<React.SetStateAction<string[]>>
  selectedLibraryFileOptions: ChatLibraryFileOption[]
  setSelectedLibraryFileOptions: React.Dispatch<React.SetStateAction<ChatLibraryFileOption[]>>
  selectedFileContextMode: ChatFileContextMode
  setSelectedFileContextMode: React.Dispatch<React.SetStateAction<ChatFileContextMode>>
  selectedLibraryFolderPaths: string[]
  setSelectedLibraryFolderPaths: React.Dispatch<React.SetStateAction<string[]>>
  libraryRagEnabled: boolean
  setLibraryRagEnabled: React.Dispatch<React.SetStateAction<boolean>>

  // Streaming
  streamingThinking: string
  setStreamingThinking: React.Dispatch<React.SetStateAction<string>>
  streamingAssistantMessage: string
  setStreamingAssistantMessage: React.Dispatch<React.SetStateAction<string>>
  optimisticThreadMessages: import('../../../../services/chat/chatDocumentStorage').StoredChatMessage[] | null
  setOptimisticThreadMessages: React.Dispatch<React.SetStateAction<import('../../../../services/chat/chatDocumentStorage').StoredChatMessage[] | null>>

  // AI health
  isCheckingAiHealth: boolean
  aiAvailabilityMessage: string | null
  setIsCheckingAiHealth: React.Dispatch<React.SetStateAction<boolean>>

  // Derived
  displayedMessages: import('../../../../services/chat/chatDocumentStorage').StoredChatMessage[]
  hasMessages: boolean
  effectiveSelectedContextPaths: string[]
  effectiveSelectedContextMode: ChatFileContextMode
  hasTransientContext: boolean
  transientContextSummaryLabel: string | null
  selectedLibraryFileSummary: ChatLibraryFileOption[]
  resolvedPreviousChats: Array<{ id: string; title: string; filePath: string }>
  filteredPreviousChats: Array<{ id: string; title: string; filePath: string }>
  chatHistoryQuery: string
  setChatHistoryQuery: React.Dispatch<React.SetStateAction<string>>
  availablePreviousChats: Array<{ id: string; title: string; filePath: string }>
  compactRecentChats: Array<{ id: string; title: string; filePath: string }>
  visibleSuggestions: ChatStarter[]
  preferredContextOption: ChatLibraryFileOption | null
  resolvedPreferredContextPaths: string[]
  resolvedTransientContextPaths: string[]
  preferredContextSignature: string
  canSubmit: boolean
  isAiAvailable: boolean
  aiHealthMessage: string | null
  setAiHealthMessage: React.Dispatch<React.SetStateAction<string | null>>
  activeModelLabel: string | null
  isResolvingActiveModel: boolean

  // History virtual list refs
  chatHistoryListRef: React.RefCallback<HTMLDivElement>
  scrollChatHistoryToIndex: (index: number, align?: 'start' | 'center' | 'end' | 'nearest') => void
  virtualChatHistoryItems: Array<{ index: number; start: number; size: number }>
  chatHistoryTotalSize: number
}

export function useChatState(props: ChatWorkspaceViewProps): UseChatStateResult {
  const {
    library,
    aiPreferences,
    previousChats = EMPTY_PREVIOUS_CHATS,
    suggestions = [],
    preferredContextPaths = EMPTY_CONTEXT_PATHS,
    preferredContextMode = null,
    preferredContextScopeKey = null,
    preferredContextName = null,
    transientContextPaths = EMPTY_CONTEXT_PATHS,
    transientContextMode = null,
    transientContextSummary = null,
    selectMatchingChatOnly = false,
    showHistoryPanel = true,
  } = props

  const [locallyDeletedChatPaths, setLocallyDeletedChatPaths] = useState<string[]>([])
  const [pendingAutoCreatedChatFilePath, setPendingAutoCreatedChatFilePath] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isHistoryPanelOpen, setIsHistoryPanelOpen] = useState(
    () => typeof window === 'undefined' || window.matchMedia(CHAT_HISTORY_DOCKED_QUERY).matches,
  )
  const [chatHistoryQuery, setChatHistoryQuery] = useState('')
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
  const [isClearingAgentMemory, setIsClearingAgentMemory] = useState(false)
  const [isAttachmentMenuOpen, setIsAttachmentMenuOpen] = useState(false)
  const [attachmentMenuPosition, setAttachmentMenuPosition] = useState<{ top: number; left: number } | null>(null)
  const [matchedPreferredChatFilePath, setMatchedPreferredChatFilePath] = useState<string | null>(null)
  const [isCheckingAiHealth, setIsCheckingAiHealth] = useState(true)
  const [aiHealthMessage, setAiHealthMessage] = useState<string | null>(null)
  const [isLibraryFilesModalOpen, setIsLibraryFilesModalOpen] = useState(false)
  const [selectedLibraryFilePaths, setSelectedLibraryFilePaths] = useState<string[]>([])
  const [selectedLibraryFileOptions, setSelectedLibraryFileOptions] = useState<ChatLibraryFileOption[]>([])
  const [selectedFileContextMode, setSelectedFileContextMode] = useState<ChatFileContextMode>('direct')
  const [selectedLibraryFolderPaths, setSelectedLibraryFolderPaths] = useState<string[]>([])
  const [libraryRagEnabled, setLibraryRagEnabled] = useState(true)
  const [selectedImageAttachments, setSelectedImageAttachments] = useState<SelectedImageAttachment[]>([])
  const [chatContextMenuState, setChatContextMenuState] = useState<{
    chatId: string
    filePath: string
    title: string
    top: number
    left: number
  } | null>(null)

  const deferredPreviousChats = useDeferredValue(previousChats)
  const locallyDeletedChatPathSet = useMemo(
    () => new Set(locallyDeletedChatPaths),
    [locallyDeletedChatPaths],
  )

  const displayedMessages = optimisticThreadMessages ?? activeChatDocument?.messages ?? []
  const hasMessages = displayedMessages.length > 0

  const visibleSuggestions = useMemo(
    () => suggestions.filter((suggestion) => suggestion.prompt.trim().length > 0).slice(0, 4),
    [suggestions],
  )
  const availablePreviousChats = useMemo(
    () => deferredPreviousChats.filter((chat) => !locallyDeletedChatPathSet.has(chat.filePath)),
    [deferredPreviousChats, locallyDeletedChatPathSet],
  )
  const resolvedPreviousChats = useMemo(
    () => availablePreviousChats.map((chat) => ({
      ...chat,
      title: normalizeChatTitle(chatTitleOverrides[chat.filePath] ?? chat.title),
    })),
    [availablePreviousChats, chatTitleOverrides],
  )
  // Narrows the already loaded history list; it does not query the library.
  const filteredPreviousChats = useMemo(() => {
    const query = chatHistoryQuery.trim().toLocaleLowerCase()
    if (!query) return resolvedPreviousChats
    return resolvedPreviousChats.filter((chat) => chat.title.toLocaleLowerCase().includes(query))
  }, [chatHistoryQuery, resolvedPreviousChats])
  const {
    containerRef: chatHistoryListRef,
    scrollToIndex: scrollChatHistoryToIndex,
    totalSize: chatHistoryTotalSize,
    virtualItems: virtualChatHistoryItems,
  } = useVirtualList({
    itemCount: filteredPreviousChats.length,
    itemSize: CHAT_HISTORY_ITEM_HEIGHT,
    overscan: 8,
  })
  const compactRecentChats = useMemo(() => resolvedPreviousChats.slice(0, 3), [resolvedPreviousChats])
  const selectedLibraryFileSummary = useMemo(
    () => selectedLibraryFileOptions.filter((option) => selectedLibraryFilePaths.includes(option.path)),
    [selectedLibraryFileOptions, selectedLibraryFilePaths],
  )
  const preferredContextPathsSignature = useMemo(
    () => preferredContextPaths.map((pathValue) => pathValue.trim()).filter(Boolean).join('\n'),
    [preferredContextPaths],
  )
  const transientContextPathsSignature = useMemo(
    () => transientContextPaths.map((pathValue) => pathValue.trim()).filter(Boolean).join('\n'),
    [transientContextPaths],
  )
  const resolvedPreferredContextPaths = useMemo(
    () => preferredContextPathsSignature ? preferredContextPathsSignature.split('\n') : EMPTY_CONTEXT_PATHS,
    [preferredContextPathsSignature],
  )
  const resolvedTransientContextPaths = useMemo(
    () => transientContextPathsSignature ? transientContextPathsSignature.split('\n') : EMPTY_CONTEXT_PATHS,
    [transientContextPathsSignature],
  )
  const hasTransientContext = transientContextMode !== null && resolvedTransientContextPaths.length > 0
  const preferredContextSignature = useMemo(
    () => [
      preferredContextMode ?? '',
      preferredContextScopeKey ?? '',
      [...resolvedPreferredContextPaths].sort().join('\n'),
    ].join('::'),
    [preferredContextMode, preferredContextScopeKey, resolvedPreferredContextPaths],
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
  const effectiveSelectedContextMode: ChatFileContextMode = hasTransientContext
    ? transientContextMode ?? 'direct'
    : selectedFileContextMode
  const [activeModelLabel, setActiveModelLabel] = useState<string | null>(null)
  const [isResolvingActiveModel, setIsResolvingActiveModel] = useState(false)
  const transientContextSummaryLabel = hasTransientContext ? transientContextSummary?.trim() || null : null
  const aiAvailabilityMessage = aiHealthMessage
  const isAiAvailable = !isCheckingAiHealth && !aiAvailabilityMessage
  const canSubmit = draft.trim().length > 0 && !isSubmitting && Boolean(library) && isAiAvailable

  // AI health check + active model resolution
  useEffect(() => {
    let cancelled = false
    setIsCheckingAiHealth(true)
    setAiHealthMessage(null)
    setIsResolvingActiveModel(true)
    setActiveModelLabel(null)

    void checkAiHealth(aiPreferences)
      .then((result) => {
        if (cancelled) {
          return
        }

        setAiHealthMessage(result.ok ? null : result.message || 'No se pudo conectar con la IA.')
        if (!result.ok) {
          setIsResolvingActiveModel(false)
          return
        }

        void resolveActiveModel(aiPreferences)
          .then((model) => {
            if (cancelled) {
              return
            }
            setActiveModelLabel(model)
          })
          .catch((error) => {
            if (cancelled) {
              return
            }
            setActiveModelLabel(null)
            setAiHealthMessage(
              error instanceof Error && error.message.trim()
                ? error.message
                : 'No se pudo determinar el modelo activo.',
            )
          })
          .finally(() => {
            if (!cancelled) {
              setIsResolvingActiveModel(false)
            }
          })
      })
      .finally(() => {
        if (!cancelled) {
          setIsCheckingAiHealth(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [aiPreferences])

  // Reset selection when preferred context changes in selectMatchingChatOnly mode
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

  // Auto-select chat file path based on matching preferred context or first available.
  // The full chat view opens on a new chat instead: it only changes the selection on request.
  useEffect(() => {
    if (showHistoryPanel) {
      return
    }

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
    library,
    pendingAutoCreatedChatFilePath,
    preferredContextMode,
    preferredContextScopeKey,
    availablePreviousChats,
    resolvedPreferredContextPaths,
    selectMatchingChatOnly,
    selectedChatFilePath,
    showHistoryPanel,
  ])

  // Keep the optimistic selection until context matching has hydrated the new chat.
  useEffect(() => {
    if (!pendingAutoCreatedChatFilePath) {
      return
    }

    if (matchedPreferredChatFilePath === pendingAutoCreatedChatFilePath) {
      setPendingAutoCreatedChatFilePath(null)
    }
  }, [matchedPreferredChatFilePath, pendingAutoCreatedChatFilePath])

  // Scroll history to selected chat
  useEffect(() => {
    if (!isHistoryPanelOpen || !selectedChatFilePath) {
      return
    }

    const selectedIndex = filteredPreviousChats.findIndex((chat) => chat.filePath === selectedChatFilePath)
    if (selectedIndex >= 0) {
      scrollChatHistoryToIndex(selectedIndex, 'nearest')
    }
  }, [isHistoryPanelOpen, filteredPreviousChats, scrollChatHistoryToIndex, selectedChatFilePath])

  // Reset matched preferred chat when preferred context changes
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

  // The backend picks the chat that fits the preferred context.
  useEffect(() => {
    if ((!preferredContextScopeKey && resolvedPreferredContextPaths.length === 0) || availablePreviousChats.length === 0) {
      setMatchedPreferredChatFilePath(null)
      return
    }
    if (!library) {
      return
    }

    let cancelled = false
    void matchChat(library.id, {
      scopeKey: preferredContextScopeKey,
      mode: preferredContextMode,
      files: resolvedPreferredContextPaths,
    }, selectedChatFilePath)
      .then((match) => { if (!cancelled) setMatchedPreferredChatFilePath(match) })
      .catch(() => { if (!cancelled) setMatchedPreferredChatFilePath(null) })

    return () => {
      cancelled = true
    }
  }, [
    preferredContextMode,
    preferredContextScopeKey,
    availablePreviousChats,
    library,
    resolvedPreferredContextPaths,
    selectedChatFilePath,
  ])

  // Sync selected library files with preferred context
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
      return areChatLibraryFileOptionsEqual(current, nextOptions) ? current : nextOptions
    })
  }, [preferredContextMode, preferredContextOption, resolvedPreferredContextPaths])

  // Load active chat document when selection changes
  useEffect(() => {
    if (!selectedChatFilePath) {
      setActiveChatDocument(null)
      setOptimisticThreadMessages(null)
      setStreamingThinking('')
      setStreamingAssistantMessage('')
      setSelectedLibraryFilePaths((current) => (
        areStringArraysEqual(current, resolvedPreferredContextPaths)
          ? current
          : resolvedPreferredContextPaths
      ))
      setSelectedLibraryFileOptions((current) => {
        const nextOptions = preferredContextOption ? [preferredContextOption] : []
        return areChatLibraryFileOptionsEqual(current, nextOptions) ? current : nextOptions
      })
      setSelectedFileContextMode((current) => {
        const nextMode = preferredContextMode ?? 'direct'
        return current === nextMode ? current : nextMode
      })
      return
    }

    if (isSubmitting) {
      return
    }

    if (!library) {
      return
    }

    let cancelled = false
    setIsChatLoading(true)
    void loadChatDocument(selectedChatFilePath, selectedChatFallbackTitle, library)
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
    library,
    selectedChatFallbackTitle,
    selectedChatFilePath,
  ])

  // Sync context files/mode from active document
  useEffect(() => {
    if (!activeChatDocument) {
      return
    }

    setSelectedLibraryFilePaths((current) => (
      areStringArraysEqual(current, activeChatDocument.selectedContextFiles)
        ? current
        : activeChatDocument.selectedContextFiles
    ))
    setSelectedLibraryFileOptions((current) => {
      if (
        preferredContextOption
        && preferredContextMode
        && activeChatDocument.selectedContextMode === preferredContextMode
        && activeChatDocument.selectedContextFiles.some((pathValue) => (
          areSameContextPaths([pathValue], [preferredContextOption.path])
        ))
      ) {
        const nextOptions = current.filter((option) => option.path !== preferredContextOption.path)
        nextOptions.unshift(preferredContextOption)
        return areChatLibraryFileOptionsEqual(current, nextOptions) ? current : nextOptions
      }

      return current.length === 0 ? current : []
    })
    setSelectedFileContextMode((current) => (
      current === activeChatDocument.selectedContextMode
        ? current
        : activeChatDocument.selectedContextMode
    ))
    // A backend older than these fields omits them; read that as the old
    // behavior (no folders, library search on) instead of failing to render.
    const contextFolders = activeChatDocument.selectedContextFolders ?? []
    setSelectedLibraryFolderPaths((current) => (
      areStringArraysEqual(current, contextFolders) ? current : contextFolders
    ))
    setLibraryRagEnabled(activeChatDocument.libraryRagEnabled ?? true)
  }, [activeChatDocument, preferredContextMode, preferredContextOption])

  // Persist preferred context changes to active document
  useEffect(() => {
    if (
      (!preferredContextScopeKey && resolvedPreferredContextPaths.length === 0)
      || !activeChatDocument
      || !selectedChatFilePath
      || !library
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
          && areSameContextPaths(activeChatDocument.selectedContextFiles, resolvedPreferredContextPaths)
        )
      )

    if (hasExpectedContext) {
      return
    }

    // The backend gives the chat the view's context and stores it.
    let cancelled = false
    void setChatViewContext(library.id, selectedChatFilePath, {
      scopeKey: preferredContextScopeKey,
      mode: preferredContextMode,
      files: resolvedPreferredContextPaths,
    })
      .then((document) => { if (!cancelled) setActiveChatDocument(document) })
      .catch((error: unknown) => {
        if (cancelled) return
        setDialogMessage(
          error instanceof Error && error.message.trim()
            ? error.message
            : 'No se pudo guardar el contexto activo del chat.',
        )
      })
    return () => {
      cancelled = true
    }
  }, [
    activeChatDocument,
    preferredContextMode,
    preferredContextScopeKey,
    resolvedPreferredContextPaths,
    library,
    selectedChatFilePath,
  ])

  return {
    selectedChatFilePath,
    setSelectedChatFilePath,
    activeChatDocument,
    setActiveChatDocument,
    isChatLoading,
    chatTitleOverrides,
    setChatTitleOverrides,
    selectedChatFallbackTitle,
    matchedPreferredChatFilePath,
    setMatchedPreferredChatFilePath,
    pendingAutoCreatedChatFilePath,
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
    isClearingAgentMemory,
    setIsClearingAgentMemory,
    chatContextMenuState,
    setChatContextMenuState,
    locallyDeletedChatPaths,
    setLocallyDeletedChatPaths,

    isAttachmentMenuOpen,
    setIsAttachmentMenuOpen,
    attachmentMenuPosition,
    setAttachmentMenuPosition,
    selectedImageAttachments,
    setSelectedImageAttachments,
    selectedLibraryFilePaths,
    setSelectedLibraryFilePaths,
    selectedLibraryFileOptions,
    setSelectedLibraryFileOptions,
    selectedFileContextMode,
    setSelectedFileContextMode,
    selectedLibraryFolderPaths,
    setSelectedLibraryFolderPaths,
    libraryRagEnabled,
    setLibraryRagEnabled,

    streamingThinking,
    setStreamingThinking,
    streamingAssistantMessage,
    setStreamingAssistantMessage,
    optimisticThreadMessages,
    setOptimisticThreadMessages,

    isCheckingAiHealth,
    aiAvailabilityMessage,
    setIsCheckingAiHealth,

    displayedMessages,
    hasMessages,
    effectiveSelectedContextPaths,
    effectiveSelectedContextMode,
    hasTransientContext,
    transientContextSummaryLabel,
    selectedLibraryFileSummary,
    resolvedPreviousChats,
    filteredPreviousChats,
    chatHistoryQuery,
    setChatHistoryQuery,
    availablePreviousChats,
    compactRecentChats,
    visibleSuggestions,
    preferredContextOption,
    resolvedPreferredContextPaths,
    resolvedTransientContextPaths,
    preferredContextSignature,
    canSubmit,
    isAiAvailable,
    aiHealthMessage,
    setAiHealthMessage,
    activeModelLabel,
    isResolvingActiveModel,

    chatHistoryListRef,
    scrollChatHistoryToIndex,
    virtualChatHistoryItems,
    chatHistoryTotalSize,
  }
}
