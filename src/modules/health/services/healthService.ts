import { callBackend, subscribeBackend, type Unsubscribe } from '../../../services/transport'
import type { NotiaLibrary } from '../../../types/notia'
import type { DashboardQuery, HealthContext, HealthDashboard, HealthError, HealthMutation, MealEstimate } from '../types/healthTypes'

/** Rust avisa con el id de la biblioteca cuando cambian los datos de Salud. */
export const HEALTH_CHANGED_EVENT = 'notia://health-changed'
/** Telegram cambió datos de la biblioteca (puede haber registrado una comida). */
const TELEGRAM_LIBRARY_CHANGED_EVENT = 'notia://telegram-library-changed'
/** En la app, Salud es del Owner que inició sesión, como Rutina. */
const OWNER_LIBRARY_USER_ID = 'user-owner'

const context = (library: NotiaLibrary): HealthContext => ({ libraryId: library.id, actorLibraryUserId: OWNER_LIBRARY_USER_ID })

export function getHealthDashboard(library: NotiaLibrary, query: DashboardQuery): Promise<HealthDashboard> {
  return callBackend<HealthDashboard>('health_dashboard', { context: context(library), query })
}

/** Rust valida y guarda el cambio, y devuelve el tablero actualizado. */
export function applyHealthMutation(library: NotiaLibrary, mutation: HealthMutation, query: DashboardQuery): Promise<HealthDashboard> {
  return callBackend<HealthDashboard>('health_apply', { context: context(library), mutation, query })
}

/** Rust le pide el plan a la IA, lo guarda y devuelve el tablero. */
export function generateHealthPlan(library: NotiaLibrary, query: DashboardQuery): Promise<HealthDashboard> {
  return callBackend<HealthDashboard>('health_generate_plan', { context: context(library), query })
}

export function estimateMeal(library: NotiaLibrary, description: string): Promise<MealEstimate> {
  return callBackend<MealEstimate>('health_estimate_meal', { context: context(library), description })
}

export async function subscribeToHealth(library: NotiaLibrary, listener: () => void): Promise<Unsubscribe> {
  const onEvent = (libraryId: unknown) => {
    if (libraryId === library.id) listener()
  }
  const stops = await Promise.all([
    subscribeBackend(HEALTH_CHANGED_EVENT, onEvent),
    subscribeBackend(TELEGRAM_LIBRARY_CHANGED_EVENT, onEvent),
  ])
  return () => stops.forEach((stop) => stop())
}

export function asHealthError(reason: unknown): HealthError {
  if (reason && typeof reason === 'object' && 'message' in reason && typeof reason.message === 'string') {
    const error = reason as Partial<HealthError>
    return { code: error.code ?? 'storage', message: reason.message, fields: error.fields ?? [] }
  }
  const message = typeof reason === 'string' && reason.trim() ? reason : 'No se pudo completar la operación de Salud.'
  return { code: 'storage', message, fields: [] }
}
