import type { MarkdownSelectionBlock, MarkdownSelectionContext } from '../views/markdownSelection'

export const WORKSPACE_AI_SNAPSHOT_VERSION = 1 as const

export type WorkspaceAiView =
  | 'documents'
  | 'graph'
  | 'chat'
  | 'task-manager'
  | 'coldpass'
  | 'meeting'
  | 'finance'
  | 'calendar'

export type WorkspaceAiScope = 'task-manager' | 'graph' | 'document' | 'library' | 'finance' | 'published'

export type WorkspaceAiDocumentKind = 'markdown' | 'text' | 'image' | 'mermaid' | 'unknown'

export interface WorkspaceAiLibrarySnapshot {
  id: string
  name: string
  path: string
}

export interface WorkspaceAiDocumentSnapshot {
  path: string
  name: string
  kind: WorkspaceAiDocumentKind
  revision: number
  dirty: boolean
  source?: string
}

export interface WorkspaceAiOpenTabSnapshot {
  path: string
  name: string
  kind: WorkspaceAiDocumentKind
  revision: number
  dirty: boolean
}

export interface WorkspaceAiCapabilities {
  canReadActiveDocument: boolean
  canReadLibrary: boolean
  canReadTasks: boolean
  canReadFinance: boolean
  canWriteActiveDocument: boolean
  canWriteLibrary: boolean
  canWriteTasks: boolean
  canWriteFinance: boolean
  canSearchWeb: boolean
  canAskClarification: boolean
  canRequestConfirmation: boolean
  canPlan: boolean
  canUndo: boolean
}

export interface WorkspaceAiSnapshot {
  snapshotVersion: typeof WORKSPACE_AI_SNAPSHOT_VERSION
  view: WorkspaceAiView
  scope: WorkspaceAiScope
  library: WorkspaceAiLibrarySnapshot | null
  activeDocument: WorkspaceAiDocumentSnapshot | null
  activeDocumentRevision: number | null
  activeDocumentDirty: boolean
  selection: MarkdownSelectionContext | null
  openTabs: readonly WorkspaceAiOpenTabSnapshot[]
  capabilities: WorkspaceAiCapabilities
  capturedAt: number
}

export type ToolErrorCode =
  | 'validation'
  | 'unauthorized'
  | 'not-found'
  | 'conflict'
  | 'cancelled'
  | 'timeout'
  | 'provider-unavailable'
  | 'storage'
  | 'unsupported'
  | 'internal'

export interface ToolError {
  code: ToolErrorCode
  message: string
  retryable: boolean
}

export interface ToolConflict {
  documentPath: string
  expectedRevision: number
  actualRevision: number
}

export type MutationPreviewAction = 'apply-all' | 'apply-selected' | 'reject' | 'edit' | 'cancel'
export type MutationHunkStatus = 'pending' | 'accepted' | 'rejected'

export interface AgentConfirmationDecision {
  accepted: boolean
  hunkIds?: readonly string[]
}

export interface MutationPreviewDocument {
  path: string
  expectedRevision: number
  currentRevision: number
}

export interface MutationPreviewHunk {
  id: string
  /** Stable opaque anchor for diagnostics and patch verification; never a document offset. */
  anchor?: string
  documentPath: string
  startLine: number
  endLine: number
  oldText: string
  newText: string
  status: MutationHunkStatus
}

export interface MutationPreview {
  operationId: string
  documents: readonly MutationPreviewDocument[]
  hunks: readonly MutationPreviewHunk[]
  summary: string
  assumptions: readonly string[]
  risks: readonly string[]
  risk?: AgentPlanRisk
  allowedActions: readonly MutationPreviewAction[]
}

export interface ToolSuccess<T> {
  ok: true
  changed: boolean
  data: T
  revision: number | null
  preview: MutationPreview | null
  code: string | null
  retryable: false
}

export interface ToolFailure {
  ok: false
  changed: false
  data: null
  revision: number | null
  preview: MutationPreview | null
  error: ToolError
  conflict: ToolConflict | null
  cancelled: boolean
  retryable: boolean
}

export type ToolResult<T> = ToolSuccess<T> | ToolFailure

export type AgentTurnState =
  | { status: 'idle' }
  | { status: 'observing'; snapshotVersion: number }
  | { status: 'clarification_required'; request: ClarificationRequest }
  | { status: 'planning'; planId: string }
  | { status: 'preview_ready'; operationId: string; preview: MutationPreview }
  | { status: 'awaiting_confirmation'; operationId: string; preview: MutationPreview }
  | { status: 'applying'; operationId: string; hunkIds: readonly string[] }
  | { status: 'verifying'; operationId: string; expectedRevision: number }
  | { status: 'completed'; operationId: string | null; changed: boolean }
  | { status: 'cancelled'; operationId: string | null }
  | { status: 'failed'; operationId: string | null; error: ToolError }

export type PendingOperationKind = 'answer' | 'mutation' | 'plan'

export interface ClarificationRequest {
  id: string
  operationId: string
  field: string
  question: string
  reason: string
  choices: readonly string[]
  allowFreeText: boolean
  pendingOperation: {
    kind: PendingOperationKind
    label: string
  }
  expiresAt: number
}

export type AgentPlanStepStatus = 'pending' | 'in-progress' | 'blocked' | 'completed' | 'failed' | 'skipped' | 'cancelled'
export type AgentPlanStatus = 'draft' | 'awaiting-approval' | 'in-progress' | 'paused' | 'completed' | 'failed' | 'cancelled'
export type AgentPlanRisk = 'low' | 'medium' | 'high' | 'critical'

export interface AgentPlanStep {
  id: string
  label: string
  description: string
  affectedPaths?: readonly string[]
  dependsOn: readonly string[]
  status: AgentPlanStepStatus
  plannedToolName: string | null
  risk: AgentPlanRisk
  canRetry: boolean
  operationId: string | null
  resultSummary: string | null
  error: ToolError | null
}

export interface AgentPlan {
  id: string
  title: string
  status: AgentPlanStatus
  requiresApproval: boolean
  approved: boolean
  steps: readonly AgentPlanStep[]
}

export type AgentProgressPhase =
  | 'preparing'
  | 'planning'
  | 'reading'
  | 'searching'
  | 'responding'
  | 'executing'
  | 'waiting-clarification'
  | 'waiting-confirmation'
  | 'verifying'
  | 'completed'
  | 'cancelled'
  | 'failed'

export type AgentMultimodalStage = 'transcribing' | 'extracting' | 'analyzing-image' | 'building-context'

/** Operational events for UI/channel feedback. This is intentionally not model thinking. */
export interface AgentProgressContext {
  /** Correlates events from one execution without exposing prompt content. */
  requestId?: string
  operationId?: string | null
  /** Assigned by the common runtime; optional for native/channel adapters that emit an event before the runtime wraps it. */
  timestamp?: number
}

export type AgentProgressEvent = AgentProgressContext & (
  | { type: 'request-received' }
  | { type: 'phase-changed'; phase: AgentProgressPhase; round: number | null }
  | { type: 'round-started'; round: number }
  | { type: 'plan-created'; plan: AgentPlan }
  | { type: 'step-started'; planStepId: string; label: string }
  | { type: 'step-completed'; planStepId: string; status: Extract<AgentPlanStepStatus, 'completed' | 'failed' | 'blocked' | 'skipped' | 'cancelled'> }
  | { type: 'tool-started'; round: number; toolName: string }
  | { type: 'tool-completed'; round: number; toolName: string; ok: boolean; changed: boolean | null }
  | { type: 'clarification-required'; clarificationId: string | null }
  | { type: 'confirmation-required'; operationId: string | null }
  | { type: 'web-search-started' }
  | { type: 'multimodal-stage'; stage: AgentMultimodalStage }
  | { type: 'verification-started'; operationId: string | null }
  | { type: 'completed'; rounds: number }
  | { type: 'cancelled' }
  | { type: 'failed'; code: ToolErrorCode }
)

export type WebSearchFreshness = 'day' | 'week' | 'month' | 'year' | 'any'

/** Contains only the already-sanitized public query; private context has no field in this contract. */
export interface WebSearchRequest {
  query: string
  queryIsSanitized: true
  maxResults: number
  freshness: WebSearchFreshness
  domains: readonly string[]
}

export interface WebSearchResult {
  rank: number
  title: string
  url: string
  snippet: string
  sourceName: string
  publishedAt: string | null
  verification: 'unverified'
  /** 0 means that the provider returned no independently verified evidence. */
  verificationScore: number
}

export interface WebSearchResponse {
  results: readonly WebSearchResult[]
  searchedQuery: string
  consistency: 'insufficient' | 'consistent' | 'mixed'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isFiniteInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value)
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isWorkspaceAiView(value: unknown): value is WorkspaceAiView {
  return value === 'documents'
    || value === 'graph'
    || value === 'chat'
    || value === 'task-manager'
    || value === 'coldpass'
    || value === 'meeting'
    || value === 'finance'
    || value === 'calendar'
}

function isWorkspaceAiScope(value: unknown): value is WorkspaceAiScope {
  return value === 'task-manager'
    || value === 'graph'
    || value === 'document'
    || value === 'library'
    || value === 'finance'
    || value === 'published'
}

function isWorkspaceAiDocumentKind(value: unknown): value is WorkspaceAiDocumentKind {
  return value === 'markdown'
    || value === 'text'
    || value === 'image'
    || value === 'mermaid'
    || value === 'unknown'
}

function isWorkspaceAiDocumentSnapshot(value: unknown): value is WorkspaceAiDocumentSnapshot {
  if (!isRecord(value)) return false
  return isNonEmptyString(value.path)
    && isNonEmptyString(value.name)
    && isWorkspaceAiDocumentKind(value.kind)
    && isFiniteInteger(value.revision)
    && value.revision >= 0
    && typeof value.dirty === 'boolean'
    && (value.source === undefined || typeof value.source === 'string')
}

function isWorkspaceAiOpenTabSnapshot(value: unknown): value is WorkspaceAiOpenTabSnapshot {
  return isWorkspaceAiDocumentSnapshot(value)
    && !('source' in value)
}

function isMarkdownSelectionBlock(value: unknown): value is MarkdownSelectionBlock {
  if (!isRecord(value)) return false
  return isFiniteInteger(value.index)
    && isNonEmptyString(value.type)
    && typeof value.text === 'string'
    && isFiniteInteger(value.from)
    && isFiniteInteger(value.to)
    && value.from >= 0
    && value.to >= value.from
}

function isMarkdownSelectionContext(value: unknown): value is MarkdownSelectionContext {
  if (!isRecord(value)) return false
  return isNonEmptyString(value.documentPath)
    && isFiniteInteger(value.from)
    && isFiniteInteger(value.to)
    && value.from >= 0
    && value.to >= value.from
    && typeof value.selectedText === 'string'
    && Array.isArray(value.blocks)
    && value.blocks.every(isMarkdownSelectionBlock)
}

function isWorkspaceAiCapabilities(value: unknown): value is WorkspaceAiCapabilities {
  if (!isRecord(value)) return false
  return typeof value.canReadActiveDocument === 'boolean'
    && typeof value.canReadLibrary === 'boolean'
    && typeof value.canReadTasks === 'boolean'
    && typeof value.canReadFinance === 'boolean'
    && typeof value.canWriteActiveDocument === 'boolean'
    && typeof value.canWriteLibrary === 'boolean'
    && typeof value.canWriteTasks === 'boolean'
    && typeof value.canWriteFinance === 'boolean'
    && typeof value.canSearchWeb === 'boolean'
    && typeof value.canAskClarification === 'boolean'
    && typeof value.canRequestConfirmation === 'boolean'
    && typeof value.canPlan === 'boolean'
    && typeof value.canUndo === 'boolean'
}

function isToolErrorCode(value: unknown): value is ToolErrorCode {
  return value === 'validation'
    || value === 'unauthorized'
    || value === 'not-found'
    || value === 'conflict'
    || value === 'cancelled'
    || value === 'timeout'
    || value === 'provider-unavailable'
    || value === 'storage'
    || value === 'unsupported'
    || value === 'internal'
}

function isToolError(value: unknown): value is ToolError {
  return isRecord(value)
    && isToolErrorCode(value.code)
    && isNonEmptyString(value.message)
    && typeof value.retryable === 'boolean'
}

function isMutationPreview(value: unknown): value is MutationPreview {
  if (!isRecord(value)) return false
  return isNonEmptyString(value.operationId)
    && Array.isArray(value.documents)
    && value.documents.every((document) => isRecord(document)
      && isNonEmptyString(document.path)
      && isFiniteInteger(document.expectedRevision)
      && document.expectedRevision >= 0
      && isFiniteInteger(document.currentRevision)
      && document.currentRevision >= 0)
    && Array.isArray(value.hunks)
    && value.hunks.every((hunk) => isRecord(hunk)
      && isNonEmptyString(hunk.id)
      && (hunk.anchor === undefined || isNonEmptyString(hunk.anchor))
      && isNonEmptyString(hunk.documentPath)
      && isFiniteInteger(hunk.startLine)
      && hunk.startLine >= 1
      && isFiniteInteger(hunk.endLine)
      && hunk.endLine >= hunk.startLine
      && typeof hunk.oldText === 'string'
      && typeof hunk.newText === 'string'
      && (hunk.status === 'pending' || hunk.status === 'accepted' || hunk.status === 'rejected'))
    && isNonEmptyString(value.summary)
    && isStringArray(value.assumptions)
    && isStringArray(value.risks)
    && (value.risk === undefined || value.risk === 'low' || value.risk === 'medium' || value.risk === 'high' || value.risk === 'critical')
    && Array.isArray(value.allowedActions)
    && value.allowedActions.every((action) => action === 'apply-all'
      || action === 'apply-selected'
      || action === 'reject'
      || action === 'edit'
      || action === 'cancel')
}

function isToolConflict(value: unknown): value is ToolConflict {
  return isRecord(value)
    && isNonEmptyString(value.documentPath)
    && isFiniteInteger(value.expectedRevision)
    && value.expectedRevision >= 0
    && isFiniteInteger(value.actualRevision)
    && value.actualRevision >= 0
}

export function isWorkspaceAiSnapshot(value: unknown): value is WorkspaceAiSnapshot {
  if (!isRecord(value)) return false
  const library = value.library
  const activeDocument = value.activeDocument
  return value.snapshotVersion === WORKSPACE_AI_SNAPSHOT_VERSION
    && isWorkspaceAiView(value.view)
    && isWorkspaceAiScope(value.scope)
    && (library === null || (isRecord(library)
      && isNonEmptyString(library.id)
      && isNonEmptyString(library.name)
      && isNonEmptyString(library.path)))
    && (activeDocument === null || isWorkspaceAiDocumentSnapshot(activeDocument))
    && (value.activeDocumentRevision === null
      || (isFiniteInteger(value.activeDocumentRevision) && value.activeDocumentRevision >= 0))
    && typeof value.activeDocumentDirty === 'boolean'
    && (value.selection === null || isMarkdownSelectionContext(value.selection))
    && Array.isArray(value.openTabs)
    && value.openTabs.every(isWorkspaceAiOpenTabSnapshot)
    && isWorkspaceAiCapabilities(value.capabilities)
    && typeof value.capturedAt === 'number'
    && Number.isFinite(value.capturedAt)
}

export function isToolResult(value: unknown): value is ToolResult<unknown> {
  if (!isRecord(value) || typeof value.ok !== 'boolean' || typeof value.changed !== 'boolean') return false
  if (value.ok) {
    return value.changed === true || value.changed === false
      ? 'data' in value
        && (value.revision === null || isFiniteInteger(value.revision))
        && (value.preview === null || isMutationPreview(value.preview))
        && (value.code === null || typeof value.code === 'string')
        && value.retryable === false
      : false
  }

  return value.changed === false
    && value.data === null
    && isToolError(value.error)
    && (value.revision === null || isFiniteInteger(value.revision))
    && (value.preview === null || isMutationPreview(value.preview))
    && (value.conflict === null || isToolConflict(value.conflict))
    && typeof value.cancelled === 'boolean'
    && typeof value.retryable === 'boolean'
}

export function isWebSearchRequest(value: unknown): value is WebSearchRequest {
  if (!isRecord(value)) return false
  const freshness = value.freshness
  return isNonEmptyString(value.query)
    && value.queryIsSanitized === true
    && isFiniteInteger(value.maxResults)
    && value.maxResults >= 1
    && value.maxResults <= 20
    && (freshness === 'day' || freshness === 'week' || freshness === 'month' || freshness === 'year' || freshness === 'any')
    && isStringArray(value.domains)
}
