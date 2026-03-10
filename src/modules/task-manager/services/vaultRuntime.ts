import { normalizeFilesystemPath } from '../../../utils/files/normalizeFilesystemPath'
import {
  createLibraryEntry,
  getPathBaseName,
  performLibraryEntryOperation,
  pickDirectory,
  readMarkdownDocuments,
  readTextFile,
  writeTextFile,
  type FilesystemMarkdownDocument,
  type FilesystemOperationResult,
  type FilesystemReadTextResult,
} from '../../../services/files/filesystemEngine'

type OperationResult = FilesystemOperationResult
type ReadLibraryFileResult = FilesystemReadTextResult
type WriteLibraryFileResult = FilesystemOperationResult
type MarkdownFileDocument = FilesystemMarkdownDocument

function notifyLibraryTreeChanged(pathHint: string) {
  if (typeof window === 'undefined') {
    return
  }

  window.dispatchEvent(new CustomEvent('notia:library-tree-changed', {
    detail: { pathHint: normalizeFilesystemPath(pathHint) },
  }))
}

export async function pickVaultDirectory(): Promise<{ path: string; name: string } | null> {
  try {
    const selected = await pickDirectory('Seleccionar vault')
    if (!selected) {
      return null
    }

    const normalizedPath = normalizeFilesystemPath(selected.path)
    const name = getPathBaseName(normalizedPath)
    return { path: normalizedPath, name }
  } catch (error) {
    console.error('[task-manager] pick vault directory failed', error)
    return null
  }
}

export async function readMarkdownFiles(directoryPath: string): Promise<MarkdownFileDocument[]> {
  if (!directoryPath.trim()) {
    return []
  }

  try {
    return await readMarkdownDocuments(normalizeFilesystemPath(directoryPath))
  } catch (error) {
    console.error('[task-manager] read_markdown_files failed', error)
    return []
  }
}

export async function readFileContent(filePath: string): Promise<ReadLibraryFileResult> {
  const normalizedPath = normalizeFilesystemPath(filePath)

  try {
    const result = await readTextFile(normalizedPath)
    if (result.ok || result.error) {
      return result
    }
    return { ...result, error: 'No se pudo leer el archivo.' }
  } catch (error) {
    console.error('[task-manager] read_library_file failed', error)
    return { ok: false, content: '', error: 'No se pudo leer el archivo.' }
  }
}

export async function writeFileContent(filePath: string, content: string): Promise<WriteLibraryFileResult> {
  const normalizedPath = normalizeFilesystemPath(filePath)

  try {
    const result = await writeTextFile(normalizedPath, content)
    if (result.ok) {
      notifyLibraryTreeChanged(normalizedPath)
    }
    if (result.ok || result.error) {
      return result
    }
    return { ...result, error: 'No se pudo escribir el archivo.' }
  } catch (error) {
    console.error('[task-manager] write_library_file failed', error)
    return { ok: false, error: 'No se pudo escribir el archivo.' }
  }
}

export async function createFolder(parentDirectoryPath: string, name: string): Promise<OperationResult> {
  try {
    const result = await createLibraryEntry(
      normalizeFilesystemPath(parentDirectoryPath),
      name,
      'folder',
    )
    if (result.ok) {
      notifyLibraryTreeChanged(`${parentDirectoryPath}/${name}`)
    }
    return result
  } catch (error) {
    console.error('[task-manager] create_library_entry(folder) failed', error)
    return { ok: false, error: 'No se pudo crear la carpeta.' }
  }
}

export async function createMarkdownFile(parentDirectoryPath: string, fileName: string): Promise<OperationResult> {
  try {
    const result = await createLibraryEntry(
      normalizeFilesystemPath(parentDirectoryPath),
      fileName,
      'note',
    )
    if (result.ok) {
      notifyLibraryTreeChanged(`${parentDirectoryPath}/${fileName}`)
    }
    return result
  } catch (error) {
    console.error('[task-manager] create_library_entry(note) failed', error)
    return { ok: false, error: 'No se pudo crear el archivo.' }
  }
}

export async function deleteEntry(targetPath: string): Promise<OperationResult> {
  try {
    const normalizedPath = normalizeFilesystemPath(targetPath)
    const result = await performLibraryEntryOperation({
      action: 'delete',
      targetPath: normalizedPath,
    })
    if (result.ok) {
      notifyLibraryTreeChanged(normalizedPath)
    }
    return result
  } catch (error) {
    console.error('[task-manager] library_entry_operation(delete) failed', error)
    return { ok: false, error: 'No se pudo eliminar la entrada.' }
  }
}

export async function renameEntry(targetPath: string, newName: string): Promise<OperationResult> {
  try {
    const normalizedPath = normalizeFilesystemPath(targetPath)
    const result = await performLibraryEntryOperation({
      action: 'rename',
      targetPath: normalizedPath,
      newName,
    })
    if (result.ok) {
      notifyLibraryTreeChanged(normalizedPath)
    }
    return result
  } catch (error) {
    console.error('[task-manager] library_entry_operation(rename) failed', error)
    return { ok: false, error: 'No se pudo renombrar la entrada.' }
  }
}

export async function moveEntry(sourcePath: string, targetDirectoryPath: string): Promise<OperationResult> {
  try {
    const normalizedSourcePath = normalizeFilesystemPath(sourcePath)
    const normalizedTargetDirectoryPath = normalizeFilesystemPath(targetDirectoryPath)
    const result = await performLibraryEntryOperation({
      action: 'paste',
      sourcePath: normalizedSourcePath,
      targetDirectoryPath: normalizedTargetDirectoryPath,
      mode: 'move',
    })
    if (result.ok) {
      notifyLibraryTreeChanged(normalizedSourcePath)
      notifyLibraryTreeChanged(normalizedTargetDirectoryPath)
    }
    return result
  } catch (error) {
    console.error('[task-manager] library_entry_operation(move) failed', error)
    return { ok: false, error: 'No se pudo mover la entrada.' }
  }
}

export async function ensureFolderPath(rootPath: string, relativePath: string): Promise<void> {
  const segments = relativePath.split('/').filter(Boolean)
  let currentPath = normalizeFilesystemPath(rootPath)

  for (const segment of segments) {
    const result = await createFolder(currentPath, segment)
    if (!result.ok && !isAlreadyExistsError(result.error)) {
      throw new Error(result.error || `No se pudo crear la carpeta ${segment}`)
    }

    currentPath = `${currentPath}/${segment}`
  }
}

function isAlreadyExistsError(error: string | undefined): boolean {
  if (!error) {
    return false
  }

  return error.toLowerCase().includes('already exists')
}
