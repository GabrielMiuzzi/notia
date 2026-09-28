import { callBackend } from '../transport'

/**
 * Sign-in of the app (`app_auth.rs`). Only the Owner opens a library: the
 * backend checks the password, unlocks the library's encrypted
 * configuration and keeps what this device remembers. The interface only
 * sends what the person typed and shows the result.
 */
export type AppAuthState = 'none' | 'unlocked' | 'locked' | 'setup'

export interface AppAuthStatus {
  state: AppAuthState
  libraryId: string | null
  libraryName: string | null
  /** User name and password remembered on this device («Recordar datos»). */
  remembered: { username: string; password: string } | null
  /** A session is remembered on this device («Recordar sesión»). */
  sessionRemembered: boolean
}

/** Event the interface sends after signing out, so the gate asks again. */
export const APP_AUTH_CHANGED_EVENT = 'notia:app-auth-changed'

export function fetchAppAuthStatus(libraryId: string | null): Promise<AppAuthStatus> {
  return callBackend<AppAuthStatus>('app_auth_status', { payload: libraryId ? { libraryId } : {} })
}

export function loginApp(input: {
  libraryId: string
  username: string
  password: string
  rememberSession: boolean
  rememberData: boolean
}): Promise<AppAuthStatus> {
  return callBackend<AppAuthStatus>('app_auth_login', { payload: input })
}

/** First step of «Primer inicio»: the Owner's user name, still without password. */
export function checkFirstLogin(libraryId: string, username: string): Promise<void> {
  return callBackend<void>('app_auth_first_login', { payload: { libraryId, username } })
}

export function createOwnerPassword(libraryId: string, username: string, password: string): Promise<AppAuthStatus> {
  return callBackend<AppAuthStatus>('app_auth_create_password', { payload: { libraryId, username, password } })
}

export function changeOwnerPassword(libraryId: string, username: string, current: string, next: string): Promise<AppAuthStatus> {
  return callBackend<AppAuthStatus>('app_auth_change_password', { payload: { libraryId, username, current, new: next } })
}

export async function logoutApp(libraryId: string | null): Promise<AppAuthStatus> {
  const status = await callBackend<AppAuthStatus>('app_auth_logout', { payload: libraryId ? { libraryId } : {} })
  window.dispatchEvent(new Event(APP_AUTH_CHANGED_EVENT))
  return status
}

/** Message of a failed backend call, for the form. */
export function authErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string' && error.message) {
    return error.message
  }
  return fallback
}
