// Shared vocabulary of the chat views for agent scopes and execution plans.

export type ChatAgentScope = 'task-manager' | 'graph' | 'document' | 'library' | 'finance'
export type ChatAgentResponseFormat = 'telegram-html'
export type ChatPersistencePolicy = 'persistent' | 'ephemeral-no-memory' | 'published-no-memory'
export type TaskExecutionStepStatus = 'pending' | 'in-progress' | 'completed' | 'blocked' | 'failed' | 'skipped' | 'cancelled'
export interface TaskExecutionStep {
  id: string
  label: string
  status: TaskExecutionStepStatus
  description?: string
  affectedPaths?: string[]
  dependsOn?: string[]
  plannedToolName?: string | null
  risk?: 'low' | 'medium' | 'high' | 'critical'
  canRetry?: boolean
  operationId?: string | null
  resultSummary?: string | null
}
