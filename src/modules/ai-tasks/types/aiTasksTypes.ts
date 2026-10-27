/** Contratos de Tareas IA tal como los devuelve Rust (`backend_core::ai_tasks::views`). */

export type AiTaskStatus =
  | 'planning'
  | 'running'
  | 'reviewing'
  | 'awaiting-approval'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted'

export type AiTaskStepStatus = 'pending' | 'running' | 'done' | 'failed'

export type AiTaskApprovalKind = 'confirmation' | 'clarification' | 'plan'

export interface AiTasksContext {
  libraryId: string
  actorLibraryUserId: string
}

export interface AiTaskCard {
  id: string
  title: string
  status: AiTaskStatus
  statusLabel: string
  phaseLabel: string
  doneSteps: number
  totalSteps: number
  origin: 'app' | 'telegram'
  originLabel: string
  approveAll: boolean
  needsYou: boolean
  createdLabel: string
  updatedLabel: string
}

export interface AiTaskStepView {
  id: string
  number: number
  roundLabel: string
  title: string
  detail: string
  status: AiTaskStepStatus
  statusLabel: string
  report: string | null
  timeLabel: string | null
}

export interface AiTaskReviewView {
  number: number
  approved: boolean
  verdictLabel: string
  feedback: string
  timeLabel: string
}

export interface AiTaskApprovalView {
  id: string
  kind: AiTaskApprovalKind
  heading: string
  title: string
  detail: string
  options: string[]
}

export interface AiTaskDetail extends AiTaskCard {
  goal: string
  steps: AiTaskStepView[]
  reviews: AiTaskReviewView[]
  pending: AiTaskApprovalView | null
  result: string | null
  error: string | null
  /** El flujo de la tarea como diagrama Mermaid, armado por Rust. */
  workflow: string
  canCancel: boolean
  canResume: boolean
  expiresLabel: string
}

export type AiTaskAnswerChoice = 'confirm' | 'confirm-all' | 'propose' | 'cancel' | 'answer'

export interface AiTaskAnswer {
  choice: AiTaskAnswerChoice
  text?: string
  optionIndex?: number
}
