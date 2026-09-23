import { invoke } from '@tauri-apps/api/core'
import type { ColdPassEntry } from '../../types/coldpass'

const COLDPASS_DIRECTORY_NAME = 'ColdPass'
const COLDPASS_FILE_NAME = 'ColdPass.md'

/** Unlocked vault as rendered by the UI. The passkey stays in the backend. */
export interface ColdPassSessionData {
  entries: ColdPassEntry[]
}

/** CSV parsed by the backend and waiting for the passkey confirmation. */
export interface ColdPassImportPreview {
  sourceFileName: string
  importedCount: number
  skippedRowCount: number
}

function joinPath(basePath: string, childName: string): string {
  const separator = basePath.includes('\\') ? '\\' : '/'
  if (basePath.endsWith('/') || basePath.endsWith('\\')) {
    return `${basePath}${childName}`
  }
  return `${basePath}${separator}${childName}`
}

/** Visible location of the vault, used only to tell first use apart. */
export function resolveColdPassPaths(libraryPath: string): { directoryPath: string; filePath: string } {
  const directoryPath = joinPath(libraryPath, COLDPASS_DIRECTORY_NAME)
  const filePath = joinPath(directoryPath, COLDPASS_FILE_NAME)
  return { directoryPath, filePath }
}

async function invokeColdPass<T>(command: string, payload: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, { payload })
  } catch (error) {
    if (error instanceof Error) throw error
    const message = error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string'
      ? (error as { message: string }).message
      : 'No se pudo completar la operación de ColdPass.'
    throw new Error(message)
  }
}

export async function unlockColdPassSession(libraryId: string, passkey: string): Promise<ColdPassSessionData> {
  return invokeColdPass<ColdPassSessionData>('coldpass_unlock', { libraryId, passkey })
}

export async function lockColdPassSession(libraryId: string): Promise<void> {
  await invokeColdPass('coldpass_lock', { libraryId })
}

/** Adds a credential, or edits `entryId` keeping its password history. */
export async function saveColdPassEntry(
  libraryId: string,
  entry: ColdPassEntry,
  entryId?: string,
): Promise<ColdPassSessionData> {
  return invokeColdPass<ColdPassSessionData>('coldpass_save_entry', {
    libraryId,
    entry,
    ...(entryId ? { entryId } : {}),
  })
}

export async function deleteColdPassEntry(
  libraryId: string,
  entryId: string,
  passkey: string,
): Promise<ColdPassSessionData> {
  return invokeColdPass<ColdPassSessionData>('coldpass_delete_entry', { libraryId, entryId, passkey })
}

/** Opens the native picker in the backend; `null` when cancelled. */
export async function pickColdPassCsvImport(libraryId: string): Promise<ColdPassImportPreview | null> {
  return invokeColdPass<ColdPassImportPreview | null>('coldpass_pick_csv_import', { libraryId })
}

export async function confirmColdPassImport(libraryId: string, passkey: string): Promise<ColdPassSessionData> {
  return invokeColdPass<ColdPassSessionData>('coldpass_confirm_import', { libraryId, passkey })
}
