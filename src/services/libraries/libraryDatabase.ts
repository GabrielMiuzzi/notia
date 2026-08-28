import { invoke } from '@tauri-apps/api/core'

export interface InitializeLibraryDatabaseResult {
  ok: boolean
  databasePath?: string
  schemaVersion?: number
  error?: string
}

export async function initializeLibraryDatabase(
  libraryPath: string,
  androidDirectoryUri?: string,
): Promise<InitializeLibraryDatabaseResult> {
  return invoke<InitializeLibraryDatabaseResult>('initialize_library_database', {
    payload: { libraryPath, androidDirectoryUri },
  })
}
