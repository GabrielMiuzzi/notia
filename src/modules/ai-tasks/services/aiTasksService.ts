import { callBackend, subscribeBackend, type Unsubscribe } from '../../../services/transport'
import type { NotiaLibrary } from '../../../types/notia'
import type { AiTaskAnswer, AiTaskCard, AiTaskDetail, AiTasksContext } from '../types/aiTasksTypes'

/** Evento que Rust emite, con el id de la biblioteca, cada vez que cambia una tarea. */
export const AI_TASK_CHANGED_EVENT = 'notia://ai-task-changed'

const OWNER_LIBRARY_USER_ID = 'user-owner'

function tasksContext(library: NotiaLibrary): AiTasksContext {
  return { libraryId: library.id, actorLibraryUserId: OWNER_LIBRARY_USER_ID }
}

export function listAiTasks(library: NotiaLibrary): Promise<AiTaskCard[]> {
  return callBackend<AiTaskCard[]>('ai_tasks_list', { context: tasksContext(library) })
}

export function getAiTask(library: NotiaLibrary, taskId: string): Promise<AiTaskDetail> {
  return callBackend<AiTaskDetail>('ai_task_get', { context: tasksContext(library), taskId })
}

export function answerAiTask(library: NotiaLibrary, taskId: string, approvalId: string, answer: AiTaskAnswer): Promise<void> {
  return callBackend('ai_task_answer', { context: tasksContext(library), taskId, approvalId, answer })
}

export function cancelAiTask(library: NotiaLibrary, taskId: string): Promise<void> {
  return callBackend('ai_task_cancel', { context: tasksContext(library), taskId })
}

export function resumeAiTask(library: NotiaLibrary, taskId: string): Promise<void> {
  return callBackend('ai_task_resume', { context: tasksContext(library), taskId })
}

export function deleteAiTask(library: NotiaLibrary, taskId: string): Promise<void> {
  return callBackend('ai_task_delete', { context: tasksContext(library), taskId })
}

/** Avisa cuando cambia alguna tarea de esta biblioteca. */
export function subscribeToAiTasks(library: NotiaLibrary, listener: () => void): Promise<Unsubscribe> {
  return subscribeBackend(AI_TASK_CHANGED_EVENT, (libraryId: unknown) => {
    if (libraryId === library.id) listener()
  })
}

export function aiTasksErrorMessage(reason: unknown): string {
  if (reason && typeof reason === 'object' && 'message' in reason && typeof reason.message === 'string') return reason.message
  if (typeof reason === 'string' && reason.trim()) return reason
  return 'No se pudo completar la operación de Tareas IA.'
}
