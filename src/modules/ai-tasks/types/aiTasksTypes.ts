/** Contratos de Tareas IA tal como los devuelve Rust (`backend_core::ai_tasks::views`). */

export type AiTaskStatus =
  | 'planning'
  | 'running'
  | 'reviewing'
  | 'awaiting-approval'
  | 'waiting'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted'

export type AiTaskStepStatus = 'pending' | 'running' | 'waiting' | 'done' | 'failed'

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
  /** Lo que hizo antes de cada espera y cómo terminó cada una. */
  notes: string[]
  timeLabel: string | null
}

/** Qué espera una tarea en estado «Esperando» (`views::AiTaskWaitView`). */
export interface AiTaskWaitView {
  reason: string
  kindLabel: string
  sinceLabel: string
  nextLabel: string | null
  deadlineLabel: string
  error: string | null
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
  wait: AiTaskWaitView | null
  result: string | null
  error: string | null
  /** El flujo de la tarea como diagrama Mermaid, armado por Rust. */
  workflow: string
  canCancel: boolean
  canResume: boolean
  /** «Reanudar» o «Seguir sin esperar». */
  resumeLabel: string
  expiresLabel: string
}

export type AiTaskAnswerChoice = 'confirm' | 'confirm-all' | 'propose' | 'cancel' | 'answer'

export interface AiTaskAnswer {
  choice: AiTaskAnswerChoice
  text?: string
  optionIndex?: number
}

export type AiTaskPhase = 'planner' | 'executor' | 'review'

/** El thinking de la fase que corre ahora, como llegó hasta el momento (`views::thinking`). */
export interface AiTaskThinking {
  requestId: string
  phase: AiTaskPhase
  stepId: string | null
  label: string
  text: string
  sequence: number
  /** Cuánto del final del texto se muestra. */
  maxChars: number
}
