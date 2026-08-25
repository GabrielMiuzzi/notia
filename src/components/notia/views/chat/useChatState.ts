import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import type { NotiaLibrary } from '../../../../types/notia'
import type { StoredChatDocument, StoredChatMessage } from '../../../../services/chat/chatDocumentStorage'
import { loadChatDocument, saveChatDocument } from '../../../../services/chat/chatDocumentStorage'
import { checkAiHealth, resolveActiveModel } from '../../../../services/ai/aiRuntime'
import { useVirtualList } from '../../../../hooks/useVirtualList'
import { toStoredLibraryPath } from '../../../../services/libraries/libraryPathMapping'
import {
  buildAttachmentDisplayName,
  type ChatFileContextMode,
  type ChatLibraryFileOption,
} from '../../../../services/chat/chatAttachmentRuntime'
import type {
  ChatWorkspaceViewProps,
  SelectedImageAttachment,
} from './ChatWorkspaceViewTypes'

const EMPTY_PREVIOUS_CHATS: Array<{ id: string; title: string; filePath: string }> = []
const EMPTY_CONTEXT_PATHS: string[] = []
const CHAT_HISTORY_ITEM_HEIGHT = 74
const MINIMAL_HISTORY_HYDRATION_CHAT_LIMIT = 8

export function normalizeChatTitle(value: string): string {
  const trimmed = value.trim()
  return trimmed || 'Chat sin titulo'
}

export function buildAutoCreateChatPayload(showHistoryPanel: boolean): {
  longTermMemoryEnabled: boolean
  contextMemoryEnabled: boolean
  contextMemoryMessageCount: number
} {
  return {
    longTermMemoryEnabled: showHistoryPanel,
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

export function normalizeComparableContextPath(
  library: NotiaLibrary | null,
  pathValue: string,
): string {
  const trimmedPath = pathValue.trim()
  if (!trimmedPath) {
    return ''
  }

  const storedPath = library
    ? toStoredLibraryPath(library.path, trimmedPath)
    : trimmedPath
  return storedPath.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '')
}

export function buildComparableContextPaths(
  library: NotiaLibrary | null,
  pathValues: string[],
): string[] {
  return pathValues
    .map((pathValue) => normalizeComparableContextPath(library, pathValue))
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right, 'es'))
}

export function areComparableContextPathsEqual(
  library: NotiaLibrary | null,
  left: string[],
  right: string[],
): boolean {
  return areStringArraysEqual(
    buildComparableContextPaths(library, left),
    buildComparableContextPaths(library, right),
  )
}

export function inferTaskManagerBoardPrefix(
  library: NotiaLibrary | null,
  scopeKey: string | null,
  contextPaths: string[],
): string | null {
  if (!scopeKey?.startsWith('task-manager:board:')) {
    return null
  }

  const firstPath = contextPaths[0]
  if (!firstPath) {
    return null
  }

  const normalizedPath = normalizeComparableContextPath(library, firstPath)
  const marker = 'task-manager/'
  const legacyMarker = 'task-mannager/'
  const markerIndex = normalizedPath.indexOf(marker)
  const legacyMarkerIndex = normalizedPath.indexOf(legacyMarker)
  const resolvedMarker = markerIndex >= 0
    ? marker
    : legacyMarkerIndex >= 0
      ? legacyMarker
      : null
  const resolvedMarkerIndex = markerIndex >= 0 ? markerIndex : legacyMarkerIndex
  if (!resolvedMarker || resolvedMarkerIndex < 0) {
    return null
  }

  const boardName = scopeKey.slice('task-manager:board:'.length).trim().toLowerCase()
  if (!boardName) {
    return null
  }

  return `${normalizedPath.slice(0, resolvedMarkerIndex)}${resolvedMarker}${boardName}/`
}

export function doesChatDocumentMatchPreferredContext(
  library: NotiaLibrary | null,
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
      && areComparableContextPathsEqual(library, document.selectedContextFiles, resolvedPreferredContextPaths)
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
  isClearingLongTermMemory: boolean
  setIsClearingLongTermMemory: React.Dispatch<React.SetStateAction<boolean>>
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
  selectedImageAttachment: SelectedImageAttachment | null
  setSelectedImageAttachment: React.Dispatch<React.SetStateAction<SelectedImageAttachment | null>>
  selectedLibraryFilePaths: string[]
  setSelectedLibraryFilePaths: React.Dispatch<React.SetStateAction<string[]>>
  selectedLibraryFileOptions: ChatLibraryFileOption[]
  setSelectedLibraryFileOptions: React.Dispatch<React.SetStateAction<ChatLibraryFileOption[]>>
  selectedFileContextMode: ChatFileContextMode
  setSelectedFileContextMode: React.Dispatch<React.SetStateAction<ChatFileContextMode>>

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
  availablePreviousChats: Array<{ id: string; title: string; filePath: string }>
  compactRecentChats: Array<{ id: string; title: string; filePath: string }>
  visibleSuggestions: string[]
  preferredContextOption: ChatLibraryFileOption | null
  resolvedPreferredContextPaths: string[]
  resolvedTransientContextPaths: string[]
  preferredContextSignature: string
  preferredTaskManagerBoardPrefix: string | null
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
    historyHydrationMode = 'full',
  } = props

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
  const [attachmentMenuPosition, setAttachmentMenuPosition] = useState<{ top: number; left: number } | null>(null)
  const [matchedPreferredChatFilePath, setMatchedPreferredChatFilePath] = useState<string | null>(null)
  const [isCheckingAiHealth, setIsCheckingAiHealth] = useState(true)
  const [aiHealthMessage, setAiHealthMessage] = useState<string | null>(null)
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

  const deferredPreviousChats = useDeferredValue(previousChats)
  const locallyDeletedChatPathSet = useMemo(
    () => new Set(locallyDeletedChatPaths),
    [locallyDeletedChatPaths],
  )

  const displayedMessages = optimisticThreadMessages ?? activeChatDocument?.messages ?? []
  const hasMessages = displayedMessages.length > 0

  const visibleSuggestions = useMemo(
    () => suggestions.filter((suggestion) => suggestion.trim().length > 0).slice(0, 4),
    [suggestions],
  )
  const availablePreviousChats = useMemo(
    () => deferredPreviousChats.filter((chat) => !locallyDeletedChatPathSet.has(chat.filePath)),
    [deferredPreviousChats, locallyDeletedChatPathSet],
  )
  const historyHydrationCandidates = useMemo(
    () => (
      historyHydrationMode === 'minimal'
        ? availablePreviousChats.slice(0, MINIMAL_HISTORY_HYDRATION_CHAT_LIMIT)
        : availablePreviousChats
    ),
    [availablePreviousChats, historyHydrationMode],
  )
  const resolvedPreviousChats = useMemo(
    () => availablePreviousChats.map((chat) => ({
      ...chat,
      title: normalizeChatTitle(chatTitleOverrides[chat.filePath] ?? chat.title),
    })),
    [availablePreviousChats, chatTitleOverrides],
  )
  const {
    containerRef: chatHistoryListRef,
    scrollToIndex: scrollChatHistoryToIndex,
    totalSize: chatHistoryTotalSize,
    virtualItems: virtualChatHistoryItems,
  } = useVirtualList({
    itemCount: resolvedPreviousChats.length,
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
      buildComparableContextPaths(library, resolvedPreferredContextPaths).join('\n'),
    ].join('::'),
    [library, preferredContextMode, preferredContextScopeKey, resolvedPreferredContextPaths],
  )
  const preferredTaskManagerBoardPrefix = useMemo(
    () => inferTaskManagerBoardPrefix(library, preferredContextScopeKey, resolvedPreferredContextPaths),
    [library, preferredContextScopeKey, resolvedPreferredContextPaths],
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

  // Auto-select chat file path based on matching preferred context or first available
  useEffect(() => {
    if (pendingAutoCreatedChatFilePath && selectedChatFilePath === pendingAutoCreatedChatFilePath) {
      return
    }

    if (selectMatchingChatOnly) {
      if (
        !matchedPreferredChatFilePath
        && selectedChatFilePath
        && doesChatDocumentMatchPreferredContext(
          library,
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
          library,
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

    const selectedIndex = resolvedPreviousChats.findIndex((chat) => chat.filePath === selectedChatFilePath)
    if (selectedIndex >= 0) {
      scrollChatHistoryToIndex(selectedIndex, 'nearest')
    }
  }, [isHistoryPanelOpen, resolvedPreviousChats, scrollChatHistoryToIndex, selectedChatFilePath])

  // Hydrate chat titles from documents
  useEffect(() => {
    if (availablePreviousChats.length === 0) {
      setChatTitleOverrides((current) => (Object.keys(current).length === 0 ? current : {}))
      return
    }

    if (historyHydrationCandidates.length === 0) {
      return
    }

    if (!library) {
      return
    }

    let cancelled = false
    void Promise.all(historyHydrationCandidates.map(async (chat) => {
      try {
        const document = await loadChatDocument(chat.filePath, chat.title, library)
        return [chat.filePath, normalizeChatTitle(document.title)] as const
      } catch {
        return [chat.filePath, normalizeChatTitle(chat.title)] as const
      }
    })).then((entries) => {
      if (cancelled) {
        return
      }

      const nextOverrides = Object.fromEntries(entries)
      setChatTitleOverrides((current) => (
        areChatTitleOverrideMapsEqual(current, nextOverrides)
          ? current
          : nextOverrides
      ))
    })

    return () => {
      cancelled = true
    }
  }, [availablePreviousChats.length, historyHydrationCandidates, library])

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

  // Match preferred context with existing chats
  useEffect(() => {
    if (!preferredContextScopeKey && resolvedPreferredContextPaths.length === 0) {
      setMatchedPreferredChatFilePath(null)
      return
    }

    if (availablePreviousChats.length === 0) {
      setMatchedPreferredChatFilePath(null)
      return
    }

    if (historyHydrationCandidates.length === 0) {
      setMatchedPreferredChatFilePath(null)
      return
    }

    if (!library) {
      return
    }

    let cancelled = false
    void Promise.all(historyHydrationCandidates.map(async (chat) => {
      try {
        const document = await loadChatDocument(chat.filePath, chat.title, library)
        const boardPrefix = preferredTaskManagerBoardPrefix
        const exactScopeMatch = Boolean(preferredContextScopeKey) && document.contextScopeKey === preferredContextScopeKey
        const exactPathsMatch = (
          Boolean(preferredContextMode)
          && resolvedPreferredContextPaths.length > 0
          && document.selectedContextMode === preferredContextMode
          && areComparableContextPathsEqual(library, document.selectedContextFiles, resolvedPreferredContextPaths)
        )
        const boardFallbackMatch = (
          Boolean(boardPrefix)
          && Boolean(preferredContextMode)
          && document.selectedContextMode === preferredContextMode
          && document.selectedContextFiles.length > 0
          && document.selectedContextFiles.every((pathValue) => (
            normalizeComparableContextPath(library, pathValue).startsWith(boardPrefix ?? '')
          ))
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
    availablePreviousChats.length,
    historyHydrationCandidates,
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
          areComparableContextPathsEqual(library, [pathValue], [preferredContextOption.path])
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
  }, [activeChatDocument, library, preferredContextMode, preferredContextOption])

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
          && areComparableContextPathsEqual(library, activeChatDocument.selectedContextFiles, resolvedPreferredContextPaths)
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

    void saveChatDocument(selectedChatFilePath, nextDocument, library).catch((error) => {
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
    isClearingLongTermMemory,
    setIsClearingLongTermMemory,
    chatContextMenuState,
    setChatContextMenuState,
    locallyDeletedChatPaths,
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
    availablePreviousChats,
    compactRecentChats,
    visibleSuggestions,
    preferredContextOption,
    resolvedPreferredContextPaths,
    resolvedTransientContextPaths,
    preferredContextSignature,
    preferredTaskManagerBoardPrefix,
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
