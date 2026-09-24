import { callBackend } from '../transport'
import type { NotiaFileNode, NotiaLibrary } from '../../types/notia'

/**
 * Library explorer client. The backend binds the library from the catalog,
 * prepares its structure, reads the tree the way the platform allows,
 * watches it, keeps the inventory and resolves every path the explorer
 * shows; this module only carries requests and results.
 */

export interface LibraryTreeView {
  nodes: NotiaFileNode[]
  /** Folders load their children on demand with `readLibraryFolder`. */
  lazy: boolean
  /** The backend watches the library; otherwise the explorer refreshes it. */
  watched: boolean
}

export interface LibraryRefresh {
  changed: boolean
  nodes?: NotiaFileNode[]
}

export interface PickedLibrary {
  name: string
  path: string
  androidTreeUri?: string
}

export interface LibraryOperationResult {
  ok: boolean
  error?: string
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message
  if (error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string') {
    return (error as { message: string }).message
  }
  if (typeof error === 'string' && error.trim()) return error
  return fallback
}

async function call<T>(command: string, payload: Record<string, unknown>, fallback: string): Promise<T> {
  try {
    return await callBackend<T>(command, { payload })
  } catch (error) {
    throw new Error(errorMessage(error, fallback))
  }
}

export function openLibrary(libraryId: string): Promise<LibraryTreeView> {
  return call('library_open', { libraryId }, 'No se pudo abrir la biblioteca.')
}

/** Re-reads the tree; without `force` the backend skips unchanged trees. */
export function refreshLibrary(libraryId: string, force = false): Promise<LibraryRefresh> {
  return call('library_refresh', { libraryId, force }, 'No se pudo actualizar la biblioteca.')
}

export function readLibraryFolder(libraryId: string, path: string): Promise<NotiaFileNode[]> {
  return call('library_read_directory', { libraryId, path }, 'No se pudo leer el contenido de la carpeta.')
}

/** Opens the platform folder picker and binds the chosen root to the id. */
export function pickLibraryDirectory(libraryId: string): Promise<PickedLibrary | null> {
  return call('library_pick_directory', { libraryId }, 'No se pudo abrir el selector de carpetas.')
}

export async function revokeLibraryBinding(libraryId: string): Promise<void> {
  await callBackend('revoke_library_binding', { libraryId })
}

/** Explorer entry mutation expressed with the paths the explorer shows. */
export type LibraryEntryMutation =
  | { action: 'create'; parentPath: string; name: string; kind: 'folder' | 'note' | 'mermaid' }
  | { action: 'delete'; targetPath: string }
  | { action: 'rename'; targetPath: string; newName: string }
  | { action: 'paste'; sourcePath: string; targetDirectoryPath: string; mode: 'copy' | 'move' }

/**
 * Sends an entry mutation to the backend, which resolves the paths inside
 * the library, performs the change (including the initial frontmatter of
 * new notes) and reports the result.
 */
export async function mutateLibraryEntry(
  library: Pick<NotiaLibrary, 'id'>,
  mutation: LibraryEntryMutation,
): Promise<LibraryOperationResult> {
  const payload = mutation.action === 'create'
    ? { action: 'create', path: mutation.parentPath, name: mutation.name, kind: mutation.kind }
    : mutation.action === 'paste'
      ? { action: 'paste', path: mutation.targetDirectoryPath, sourcePath: mutation.sourcePath, mode: mutation.mode }
      : mutation.action === 'rename'
        ? { action: 'rename', path: mutation.targetPath, name: mutation.newName }
        : { action: 'delete', path: mutation.targetPath }
  try {
    return await callBackend<LibraryOperationResult>('library_mutate_entry', {
      payload: { libraryId: library.id, ...payload },
    })
  } catch (error) {
    return { ok: false, error: errorMessage(error, 'No se pudo completar la operación.') }
  }
}
