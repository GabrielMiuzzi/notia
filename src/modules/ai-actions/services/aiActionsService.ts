import { callBackend, subscribeBackend, type Unsubscribe } from '../../../services/transport'
import type { NotiaLibrary } from '../../../types/notia'
import type {
  ActionForm,
  ActionPreview,
  AiActionInput,
  AiActionsContext,
  AiActionsDashboard,
  DashboardFilter,
  FieldError,
  RunRow,
} from '../types/aiActionsTypes'

/** Eventos que Rust emite, con el id de la biblioteca, al cambiar acciones o ejecuciones. */
export const AI_ACTION_CHANGED_EVENT = 'notia://ai-action-changed'
export const AI_RUN_UPDATED_EVENT = 'notia://ai-run-updated'

const OWNER_LIBRARY_USER_ID = 'user-owner'

function actionsContext(library: NotiaLibrary): AiActionsContext {
  return {
    libraryId: library.id,
    libraryPath: library.path,
    androidDirectoryUri: library.androidTreeUri ?? null,
    actorLibraryUserId: OWNER_LIBRARY_USER_ID,
  }
}

export function getAiActionsDashboard(library: NotiaLibrary, filter: DashboardFilter, query: string): Promise<AiActionsDashboard> {
  return callBackend<AiActionsDashboard>('ai_actions_dashboard', { context: actionsContext(library), filter, query })
}

export function previewAiAction(library: NotiaLibrary, actionId: string | null, input: AiActionInput): Promise<ActionPreview> {
  return callBackend<ActionPreview>('ai_action_preview', { context: actionsContext(library), actionId, input })
}

export function getAiAction(library: NotiaLibrary, actionId: string): Promise<ActionForm> {
  return callBackend<ActionForm>('ai_action_get', { context: actionsContext(library), actionId })
}

export function createAiAction(library: NotiaLibrary, input: AiActionInput): Promise<{ actionId: string }> {
  return callBackend('ai_action_create', { context: actionsContext(library), input })
}

export function updateAiAction(library: NotiaLibrary, actionId: string, input: AiActionInput): Promise<{ actionId: string }> {
  return callBackend('ai_action_update', { context: actionsContext(library), actionId, input })
}

export function setAiActionEnabled(library: NotiaLibrary, actionId: string, enabled: boolean): Promise<void> {
  return callBackend('ai_action_set_enabled', { context: actionsContext(library), actionId, enabled })
}

export function deleteAiAction(library: NotiaLibrary, actionId: string): Promise<void> {
  return callBackend('ai_action_delete', { context: actionsContext(library), actionId })
}

export function getAiActionRuns(library: NotiaLibrary, actionId: string): Promise<RunRow[]> {
  return callBackend<RunRow[]>('ai_action_runs', { context: actionsContext(library), actionId })
}

export function retryAiRun(library: NotiaLibrary, runId: string): Promise<{ runId: string }> {
  return callBackend('ai_action_retry', { context: actionsContext(library), runId })
}

export function testAiPrompt(library: NotiaLibrary, input: AiActionInput): Promise<{ runId: string }> {
  return callBackend('ai_action_test', { context: actionsContext(library), input })
}

/** Avisa cuando cambian las acciones o las ejecuciones de esta biblioteca. */
export async function subscribeToAiActions(library: NotiaLibrary, listener: () => void): Promise<Unsubscribe> {
  const onEvent = (libraryId: unknown) => {
    if (libraryId === library.id) listener()
  }
  const stops = await Promise.all([
    subscribeBackend(AI_ACTION_CHANGED_EVENT, onEvent),
    subscribeBackend(AI_RUN_UPDATED_EVENT, onEvent),
  ])
  return () => stops.forEach((stop) => stop())
}

export function aiActionsErrorMessage(reason: unknown): string {
  if (reason && typeof reason === 'object' && 'message' in reason && typeof reason.message === 'string') {
    return reason.message
  }
  if (typeof reason === 'string' && reason.trim()) return reason
  return 'No se pudo completar la operación de Acciones IA.'
}

export function aiActionsErrorFields(reason: unknown): FieldError[] {
  if (reason && typeof reason === 'object' && 'fields' in reason && Array.isArray(reason.fields)) {
    return reason.fields as FieldError[]
  }
  return []
}
