import type { ChatFileContextMode } from '../../../../services/chat/chatAttachmentRuntime'
import type { ChatHistoryGroup } from '../../../../services/chat/chatDocumentStorage'

/*
 * Copy the chat's context surfaces share: the desktop context panel, the
 * phone context sheet and the history lists. It describes the state the
 * backend keeps; it decides nothing.
 */

/** What the chat searches, as the scope chip says it. */
export function libraryScopeLabel(libraryRagEnabled: boolean, libraryName: string | null): string {
  return libraryRagEnabled
    ? `Búsqueda en ${libraryName ? `la librería ${libraryName}` : 'toda la librería'}`
    : 'Sin búsqueda en la librería'
}

/** How the AI uses the library and the files or folders chosen as context. */
export function libraryScopeHint(libraryRagEnabled: boolean, hasChosenContext: boolean, contextMode: ChatFileContextMode): string {
  if (!hasChosenContext) {
    return libraryRagEnabled
      ? 'La IA busca en toda la librería. Podés sumar archivos o carpetas como contexto fijo.'
      : 'La IA no tiene acceso a la librería. Sumá archivos o carpetas para darle contexto.'
  }
  if (contextMode !== 'index') return 'Directo: se envía el contenido de los archivos, hasta 30.000 caracteres.'
  return libraryRagEnabled
    ? 'Referencia: la IA recibe nombres y rutas y lee los archivos si los necesita.'
    : 'Referencia sin búsqueda: la IA solo recibe nombres y rutas, no el contenido.'
}

/** Whether the chat uses `memory.md`, chosen when the chat is created. */
export function agentMemoryHint(isChoiceLocked: boolean, enabled: boolean): string {
  if (isChoiceLocked) return `Este chat ${enabled ? 'usa' : 'no usa'} memory.md. Se elige al crear el chat.`
  return enabled
    ? 'El chat nuevo usa memory.md y puede guardar reglas y memorias.'
    : 'El chat nuevo no lee memory.md ni guarda reglas o memorias. Las reglas de rules.md se siguen aplicando.'
}

/** Names of the history groups the backend sorts the chats into. */
export const HISTORY_GROUP_LABELS: Record<ChatHistoryGroup, string> = {
  pinned: 'Fijados',
  today: 'Hoy',
  yesterday: 'Ayer',
  thisWeek: 'Esta semana',
  earlier: 'Anteriores',
}

export const HISTORY_GROUP_ORDER: ChatHistoryGroup[] = ['pinned', 'today', 'yesterday', 'thisWeek', 'earlier']
