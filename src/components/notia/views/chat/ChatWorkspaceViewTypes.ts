import type { NotiaLibrary } from '../../types/notia'
import type { AiPreferences } from '../../services/preferences/aiSettingsStorage'
import type {
  StoredChatDocument,
  StoredChatMessage,
} from '../../services/chat/chatDocumentStorage'
import type {
  ChatFileContextMode,
  ChatLibraryFileOption,
} from '../../services/chat/chatAttachmentRuntime'

export interface ChatWorkspaceViewProps {
  library: NotiaLibrary | null
  aiPreferences: AiPreferences
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
  historyHydrationMode?: 'full' | 'minimal'
  onChatCreated?: (filePath: string) => void | Promise<void>
  onChatDeleted?: (filePath: string) => void | Promise<void>
}

export interface SelectedImageAttachment {
  name: string
  mimeType: string
  base64: string
}

export interface AttachmentMenuPosition {
  top: number
  left: number
}

export interface ChatContextMenuState {
  chatId: string
  filePath: string
  title: string
  top: number
  left: number
}

export interface CreateChatPayload {
  longTermMemoryEnabled: boolean
  contextMemoryEnabled: boolean
  contextMemoryMessageCount: number
}

export interface ChatSelectionState {
  selectedChatFilePath: string | null
  activeChatDocument: StoredChatDocument | null
  isChatLoading: boolean
  chatTitleOverrides: Record<string, string>
}

export interface ChatComposerState {
  draft: string
  setDraft: (value: string) => void
  isSubmitting: boolean
  canSubmit: boolean
  isAiAvailable: boolean
  isCheckingAiHealth: boolean
  aiAvailabilityMessage: string | null
}

export interface ChatAttachmentState {
  isAttachmentMenuOpen: boolean
  attachmentMenuPosition: AttachmentMenuPosition | null
  selectedImageAttachment: SelectedImageAttachment | null
  selectedLibraryFilePaths: string[]
  selectedLibraryFileOptions: ChatLibraryFileOption[]
  selectedFileContextMode: ChatFileContextMode
  effectiveSelectedContextPaths: string[]
  effectiveSelectedContextMode: ChatFileContextMode
  transientContextSummaryLabel: string | null
  hasTransientContext: boolean
  selectedLibraryFileSummary: ChatLibraryFileOption[]
}

export interface ChatStreamingState {
  streamingThinking: string
  streamingAssistantMessage: string
  optimisticThreadMessages: StoredChatMessage[] | null
}

export interface ChatModalState {
  isCreateChatModalOpen: boolean
  createChatErrorMessage: string | null
  isCreateChatSubmitting: boolean
  isChatToolsModalOpen: boolean
  isLibraryFilesModalOpen: boolean
  dialogMessage: string | null
  isClearingLongTermMemory: boolean
}

export interface ChatHistoryState {
  isHistoryPanelOpen: boolean
  resolvedPreviousChats: Array<{ id: string; title: string; filePath: string }>
  availablePreviousChats: Array<{ id: string; title: string; filePath: string }>
  virtualChatHistoryItems: Array<{ index: number; start: number; size: number }>
  chatHistoryTotalSize: number
  chatHistoryListRef: React.RefObject<HTMLDivElement | null>
  compactRecentChats: Array<{ id: string; title: string; filePath: string }>
}

export type SubmitMessageResult =
  | { ok: true }
  | { ok: false; error: string }

export interface UseChatSubmitMessageDependencies {
  library: NotiaLibrary | null
  aiPreferences: AiPreferences
  activeChatDocument: StoredChatDocument | null
  selectedChatFilePath: string | null
  effectiveSelectedContextPaths: string[]
  effectiveSelectedContextMode: ChatFileContextMode
  selectedLibraryFilePaths: string[]
  selectedLibraryFileOptions: ChatLibraryFileOption[]
  selectedImageAttachment: SelectedImageAttachment | null
  selectedFileContextMode: ChatFileContextMode
  showHistoryPanel: boolean
  preferredContextScopeKey: string | null
  persistTransientContext: boolean
  hasTransientContext: boolean
  onChatCreated?: (filePath: string) => void | Promise<void>
}

export interface UseChatSubmitMessageState {
  draft: string
  setDraft: (value: string) => void
  isSubmitting: boolean
  optimisticThreadMessages: StoredChatMessage[] | null
  streamingThinking: string
  streamingAssistantMessage: string
  setStreamingThinking: (value: string) => void
  setStreamingAssistantMessage: (value: string) => void
  setOptimisticThreadMessages: (value: StoredChatMessage[] | null) => void
  setActiveChatDocument: React.Dispatch<React.SetStateAction<StoredChatDocument | null>>
  setChatTitleOverrides: React.Dispatch<React.SetStateAction<Record<string, string>>>
  setSelectedImageAttachment: (value: SelectedImageAttachment | null) => void
  setSelectedLibraryFilePaths: React.Dispatch<React.SetStateAction<string[]>>
  setSelectedLibraryFileOptions: React.Dispatch<React.SetStateAction<ChatLibraryFileOption[]>>
  setSelectedFileContextMode: React.Dispatch<React.SetStateAction<ChatFileContextMode>>
  setPendingAutoCreatedChatFilePath: React.Dispatch<React.SetStateAction<string | null>>
  setIsAttachmentMenuOpen: (value: boolean) => void
  setDialogMessage: (value: string | null) => void
  setIsSubmitting: (value: boolean) => void
}

export type UseChatSubmitMessage = (
  deps: UseChatSubmitMessageDependencies,
  state: UseChatSubmitMessageState,
) => (rawMessage: string) => Promise<void>

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
  setDraft: (value: string) => void
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
  optimisticThreadMessages: StoredChatMessage[] | null
  setOptimisticThreadMessages: React.Dispatch<React.SetStateAction<StoredChatMessage[] | null>>

  // AI health
  isCheckingAiHealth: boolean
  aiAvailabilityMessage: string | null
  setIsCheckingAiHealth: React.Dispatch<React.SetStateAction<boolean>>
  setAiAvailabilityMessage: React.Dispatch<React.SetStateAction<string | null>>

  // Derived
  displayedMessages: StoredChatMessage[]
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
  chatHistoryListRef: React.RefObject<HTMLDivElement | null>
  scrollChatHistoryToIndex: (index: number, align?: 'start' | 'center' | 'end' | 'nearest') => void
  virtualChatHistoryItems: Array<{ index: number; start: number; size: number }>
  chatHistoryTotalSize: number
}
