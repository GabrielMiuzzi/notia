import { callBackend } from '../transport'
import type { HomeDashboard } from './homeTypes'

/** The Home dashboard of a library, built by Rust from every module. */
export function getHomeDashboard(libraryId: string): Promise<HomeDashboard> {
  return callBackend<HomeDashboard>('home_dashboard', { payload: { libraryId } })
}

export function homeErrorMessage(reason: unknown, fallback: string): string {
  if (reason && typeof reason === 'object' && 'message' in reason && typeof reason.message === 'string' && reason.message.trim()) {
    return reason.message
  }
  if (typeof reason === 'string' && reason.trim()) return reason
  return fallback
}
