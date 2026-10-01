import { callBackend, subscribeBackend, type Unsubscribe } from '../../../services/transport'
import type { NotiaLibrary } from '../../../types/notia'
import type {
  BodyView,
  CatalogMutation,
  CatalogResult,
  ExerciseDetail,
  GymApplyResult,
  GymContext,
  GymError,
  GymMutation,
  GymQuery,
  GymView,
  MediaInput,
} from '../types/gymTypes'

/** Rust avisa con el id de la biblioteca cuando cambian los datos o el catálogo. */
export const GYM_CHANGED_EVENT = 'notia://gym-changed'
/** En la app, Gimnasio es del Owner que inició sesión, como Salud. */
const OWNER_LIBRARY_USER_ID = 'user-owner'

const context = (library: NotiaLibrary): GymContext => ({ libraryId: library.id, actorLibraryUserId: OWNER_LIBRARY_USER_ID })

export function getGymView(library: NotiaLibrary, query: GymQuery): Promise<GymView> {
  return callBackend<GymView>('gym_view', { context: context(library), query })
}

/** Rust valida y guarda el cambio, y devuelve la vista actualizada. */
export function applyGymMutation(library: NotiaLibrary, mutation: GymMutation, query: GymQuery): Promise<GymApplyResult> {
  return callBackend<GymApplyResult>('gym_apply', { context: context(library), mutation, query })
}

export function getExercise(library: NotiaLibrary, exerciseId: string): Promise<ExerciseDetail> {
  return callBackend<ExerciseDetail>('gym_exercise', { context: context(library), exerciseId })
}

/** Un cambio de la ficha o del equipamiento propio: Rust reescribe el `.md`. */
export function applyCatalogMutation(library: NotiaLibrary, mutation: CatalogMutation, photo: MediaInput | null = null): Promise<CatalogResult> {
  return callBackend<CatalogResult>('gym_catalog_apply', { context: context(library), mutation, photo })
}

export function setExerciseMedia(library: NotiaLibrary, exerciseId: string, media: MediaInput): Promise<ExerciseDetail> {
  return callBackend<ExerciseDetail>('gym_set_media', { context: context(library), exerciseId, media })
}

export function getExerciseVideo(library: NotiaLibrary, exerciseId: string): Promise<MediaInput | null> {
  return callBackend<MediaInput | null>('gym_video', { context: context(library), exerciseId })
}

export function getEquipmentImages(library: NotiaLibrary): Promise<Record<string, string>> {
  return callBackend<Record<string, string>>('gym_equipment_images', { context: context(library) })
}

export function getBody(library: NotiaLibrary): Promise<BodyView> {
  return callBackend<BodyView>('gym_body', { context: context(library) })
}

export function subscribeToGym(library: NotiaLibrary, listener: () => void): Promise<Unsubscribe> {
  return subscribeBackend(GYM_CHANGED_EVENT, (libraryId: unknown) => {
    if (libraryId === library.id) listener()
  })
}

export function asGymError(reason: unknown): GymError {
  if (reason && typeof reason === 'object' && 'message' in reason && typeof reason.message === 'string') {
    const error = reason as Partial<GymError>
    return { code: error.code ?? 'storage', message: reason.message }
  }
  const message = typeof reason === 'string' && reason.trim() ? reason : 'No se pudo completar la operación de Gimnasio.'
  return { code: 'storage', message }
}

/** Un archivo elegido, como lo recibe Rust (base64 sin el prefijo `data:`). */
export function readMedia(file: File): Promise<MediaInput> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result ?? '')
      resolve({ mediaType: file.type || 'application/octet-stream', base64: result.slice(result.indexOf(',') + 1) })
    }
    reader.onerror = () => reject(new Error('No se pudo leer el archivo.'))
    reader.readAsDataURL(file)
  })
}
