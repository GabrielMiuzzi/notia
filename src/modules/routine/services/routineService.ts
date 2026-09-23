import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { NotiaLibrary } from '../../../types/notia'
import type { RoutineContext, RoutineDashboard, RoutineMutation, RoutineMutationResponse } from '../types/routineTypes'

/** Evento emitido por Rust cuando el agente modifica datos de Rutina. */
export const ROUTINE_DATA_CHANGED_EVENT = 'notia:routine-data-changed'

const OWNER_LIBRARY_USER_ID = 'user-owner'

function routineContext(library: NotiaLibrary): RoutineContext {
  return {
    libraryPath: library.path,
    androidDirectoryUri: library.androidTreeUri,
    actorLibraryUserId: OWNER_LIBRARY_USER_ID,
    source: 'app',
  }
}

export function getRoutineDashboard(library: NotiaLibrary): Promise<RoutineDashboard> {
  return invoke<RoutineDashboard>('routine_get_dashboard', { context: routineContext(library) })
}

export function applyRoutineMutation(library: NotiaLibrary, mutation: RoutineMutation): Promise<RoutineMutationResponse> {
  return invoke<RoutineMutationResponse>('routine_apply_mutation', {
    payload: { context: routineContext(library), mutation },
  })
}

export function subscribeToRoutineDataChanges(listener: () => void): Promise<UnlistenFn> {
  return listen(ROUTINE_DATA_CHANGED_EVENT, () => listener())
}

export function routineErrorMessage(reason: unknown): string {
  if (reason && typeof reason === 'object' && 'message' in reason && typeof reason.message === 'string') {
    return reason.message
  }
  if (typeof reason === 'string' && reason.trim()) return reason
  return 'No se pudo completar la operación de Rutina.'
}
