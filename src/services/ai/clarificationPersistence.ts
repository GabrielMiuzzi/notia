import { callBackend } from '../transport'

/*
 * The last clarification the agent asked in a library lives in the backend
 * (`agent_pending.rs`) so it reappears after the WebView reloads. The
 * backend decides whether it still applies to the open document and builds
 * the continuation prompt from the answer.
 */

export interface ClarificationContext {
  scope: string
  documentPath: string | null
  revision: number | null
}

export type PendingClarification =
  | { status: 'none' }
  | { status: 'waiting' }
  | { status: 'pending'; question: string; choices: string[] }

export async function savePendingClarification(
  libraryId: string,
  question: string,
  choices: string[],
  context: ClarificationContext,
): Promise<void> {
  await callBackend('backend_save_pending_clarification', { payload: { libraryId, question, choices, ...context } })
}

export function loadPendingClarification(libraryId: string, context: ClarificationContext): Promise<PendingClarification> {
  return callBackend<PendingClarification>('backend_pending_clarification', { payload: { libraryId, ...context } })
}

export async function clearPendingClarification(libraryId: string): Promise<void> {
  await callBackend('backend_clear_pending_clarification', { payload: { libraryId } })
}

/** Continuation prompt for the answer, or `null` when the user cancelled. */
export function answerPendingClarification(libraryId: string, answer: string): Promise<string | null> {
  return callBackend<string | null>('backend_answer_pending_clarification', { payload: { libraryId, answer } })
}
