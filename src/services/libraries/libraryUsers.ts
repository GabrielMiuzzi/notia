import { invoke } from '@tauri-apps/api/core'

export interface LibraryDatabaseContext {
  libraryPath: string
  androidDirectoryUri?: string
}

export interface LibraryRole {
  id: string
  name: string
}

export interface LibraryUser {
  id: string
  name: string
  roleId: string
  roleName: string
  passwordConfigured: boolean
  telegramLinked: boolean
  allowedContexts: string[]
  allContexts: boolean
}

export interface LibraryDataError {
  code: string
  message: string
}

export class LibraryUsersError extends Error {
  readonly code: string

  constructor(error: unknown) {
    const parsed = typeof error === 'string' ? (() => {
      try { return JSON.parse(error) as unknown } catch { return null }
    })() : null
    const value = (typeof error === 'object' && error !== null ? error : parsed) as Partial<LibraryDataError> | null
    super(typeof value?.message === 'string' ? value.message : typeof error === 'string' ? error : 'No se pudo actualizar la biblioteca.')
    this.name = 'LibraryUsersError'
    this.code = typeof value?.code === 'string' ? value.code : 'unknown'
  }
}

function payload(context: LibraryDatabaseContext): LibraryDatabaseContext {
  return { libraryPath: context.libraryPath, androidDirectoryUri: context.androidDirectoryUri }
}

async function invokeLibrary<T>(command: string, value: unknown): Promise<T> {
  try {
    return await invoke<T>(command, { payload: value })
  } catch (error) {
    throw new LibraryUsersError(error)
  }
}

export function listLibraryRoles(context: LibraryDatabaseContext): Promise<LibraryRole[]> {
  return invokeLibrary('list_library_roles', payload(context))
}

export function createLibraryRole(context: LibraryDatabaseContext, name: string): Promise<LibraryRole[]> {
  return invokeLibrary('create_library_role', { context: payload(context), name })
}

export function listLibraryUsers(context: LibraryDatabaseContext): Promise<LibraryUser[]> {
  return invokeLibrary('list_library_users', payload(context))
}

export function createLibraryUser(context: LibraryDatabaseContext, name: string, roleId: string): Promise<LibraryUser[]> {
  return invokeLibrary('create_library_user', { context: payload(context), name, roleId })
}

export function updateLibraryUserPassword(context: LibraryDatabaseContext, userId: string, password: string): Promise<LibraryUser[]> {
  return invokeLibrary('update_library_user_password', { context: payload(context), userId, password })
}

export function deleteLibraryUser(context: LibraryDatabaseContext, userId: string): Promise<LibraryUser[]> {
  return invokeLibrary('delete_library_user', { context: payload(context), userId })
}

export function updateLibraryUserName(context: LibraryDatabaseContext, userId: string, name: string): Promise<LibraryUser[]> {
  return invokeLibrary('update_library_user_name', { context: payload(context), userId, name })
}

export function updateLibraryUserRole(context: LibraryDatabaseContext, userId: string, roleId: string): Promise<LibraryUser[]> {
  return invokeLibrary('update_library_user_role', { context: payload(context), userId, roleId })
}

export function updateLibraryUserContexts(context: LibraryDatabaseContext, userId: string, contextTags: string[]): Promise<LibraryUser[]> {
  return invokeLibrary('update_library_user_contexts', { context: payload(context), userId, contextTags })
}

export function resolveLibraryTelegramUser(context: LibraryDatabaseContext, telegramUserId: number, telegramChatId: number): Promise<LibraryUser | null> {
  return invokeLibrary('resolve_library_telegram_user', { context: payload(context), telegramUserId, telegramChatId })
}

export function findLibraryUser(context: LibraryDatabaseContext, name: string): Promise<LibraryUser | null> {
  return invokeLibrary('find_library_user', { context: payload(context), name })
}

export function linkLibraryUserTelegram(context: LibraryDatabaseContext, userId: string, telegramUserId: number, telegramChatId: number, password: string): Promise<LibraryUser> {
  return invokeLibrary('link_library_user_telegram', { context: payload(context), userId, telegramUserId, telegramChatId, password })
}

export function unlinkLibraryUserTelegram(context: LibraryDatabaseContext, userId: string): Promise<LibraryUser[]> {
  return invokeLibrary('unlink_library_user_telegram', { context: payload(context), userId })
}
