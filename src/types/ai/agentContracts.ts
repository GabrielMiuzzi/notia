import type { MarkdownSelectionContext } from '../views/markdownSelection'

export const WORKSPACE_AI_SNAPSHOT_VERSION = 1 as const

export type WorkspaceAiView =
  | 'documents'
  | 'graph'
  | 'chat'
  | 'task-manager'
  | 'coldpass'
  | 'meeting'
  | 'finance'
  | 'multichat'
  | 'calendar'
  | 'routine'

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
  capturedAt: number
}

export type ToolErrorCode =
  | 'validation'
  | 'unauthorized'
  | 'missing-actor'
  | 'invalid-source'
  | 'unauthorized-context'
  | 'unauthorized-tool'
  | 'session-revoked'
  | 'library-mismatch'
  | 'resource-not-found'
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

