import { callBackend } from '../../../services/transport'
import type { NotiaLibrary } from '../../../types/notia'
import type { AgendaContext, AgendaMutation, AgendaMutationResponse, AgendaView, AgendaViewRequest } from '../types/agendaTypes'

const OWNER_LIBRARY_USER_ID = 'user-owner'

function agendaContext(library: NotiaLibrary): AgendaContext {
  return {
    libraryPath: library.path,
    androidDirectoryUri: library.androidTreeUri,
    actorLibraryUserId: OWNER_LIBRARY_USER_ID,
  }
}

export function getAgendaView(library: NotiaLibrary, request: AgendaViewRequest): Promise<AgendaView> {
  return callBackend<AgendaView>('agenda_get_view', { context: agendaContext(library), request })
}

export function applyAgendaMutation(
  library: NotiaLibrary,
  mutation: AgendaMutation,
  request: AgendaViewRequest,
): Promise<AgendaMutationResponse> {
  return callBackend<AgendaMutationResponse>('agenda_apply_mutation', {
    payload: { context: agendaContext(library), mutation, request },
  })
}

export function agendaErrorMessage(reason: unknown): string {
  if (reason && typeof reason === 'object' && 'message' in reason && typeof reason.message === 'string') {
    return reason.message
  }
  if (typeof reason === 'string' && reason.trim()) return reason
  return 'No se pudo completar la operación de la Agenda.'
}
