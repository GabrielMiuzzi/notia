import { normalizeFilesystemPath } from '../../../utils/files/normalizeFilesystemPath'
import { getRuntimeDevice } from '../../../utils/platform/getRuntimeDevice'
import {
  createLibraryEntry,
  getPathBaseName,
  isDirectoryPath,
  performLibraryEntryOperation,
  pathExists,
  pickDirectory,
  readLibraryTree,
  readMarkdownDocuments,
  readTextFile,
  writeTextFile,
  type FilesystemTreeNode,
  type FilesystemMarkdownDocument,
  type FilesystemOperationResult,
  type FilesystemReadTextResult,
} from '../../../services/files/filesystemEngine'
import { dispatchLibraryTreeChanged } from '../../../services/libraries/libraryTreeEvents'
import type { TaskManagerVaultRef } from '../types/taskManagerTypes'

type OperationResult = FilesystemOperationResult
type ReadLibraryFileResult = FilesystemReadTextResult
type WriteLibraryFileResult = FilesystemOperationResult
type MarkdownFileDocument = FilesystemMarkdownDocument

let activeTaskManagerVaultRef: TaskManagerVaultRef | null = null
let pendingTreeChangeFlushTimerId: number | null = null
const pendingTreeChangeHints = new Set<string>()

function normalizeVaultRef(vault: TaskManagerVaultRef | null): TaskManagerVaultRef | null {
  if (!vault?.path.trim()) {
    return null
  }

  return {
    path: normalizeFilesystemPath(vault.path),
    androidTreeUri: typeof vault.androidTreeUri === 'string' && vault.androidTreeUri.trim()
      ? vault.androidTreeUri
      : undefined,
  }
}

function resolveAndroidDirectoryUri(pathValue: string): string | undefined {
  const vaultRef = activeTaskManagerVaultRef
  if (!vaultRef?.androidTreeUri) {
    return undefined
  }

  const normalizedPath = normalizeFilesystemPath(pathValue)
  const normalizedVaultPath = normalizeFilesystemPath(vaultRef.path).replace(/[\\/]+$/, '')
  if (normalizedPath === normalizedVaultPath || normalizedPath.startsWith(`${normalizedVaultPath}/`)) {
    return vaultRef.androidTreeUri
  }

  return undefined
}

function isNestedPath(basePath: string, candidatePath: string): boolean {
  const normalizedBasePath = normalizeFilesystemPath(basePath).replace(/[\\/]+$/, '')
  const normalizedCandidatePath = normalizeFilesystemPath(candidatePath)
  return normalizedCandidatePath === normalizedBasePath
    || normalizedCandidatePath.startsWith(`${normalizedBasePath}/`)
}

function collectMarkdownPathsFromTree(
  nodes: FilesystemTreeNode[],
  target: string[],
): void {
  for (const node of nodes) {
    if (node.type === 'file' && node.path && node.path.toLowerCase().endsWith('.md')) {
      target.push(node.path)
      continue
    }

    if (node.children && node.children.length > 0) {
      collectMarkdownPathsFromTree(node.children, target)
    }
  }
}

export function setActiveTaskManagerVaultContext(vault: TaskManagerVaultRef | null): void {
  activeTaskManagerVaultRef = normalizeVaultRef(vault)
}

function notifyLibraryTreeChanged(pathHint: string) {
  if (typeof window === 'undefined') {
    return
  }

  const normalizedPathHint = normalizeFilesystemPath(pathHint)
  if (!normalizedPathHint.trim()) {
    return
  }

  pendingTreeChangeHints.add(normalizedPathHint)
  if (pendingTreeChangeFlushTimerId !== null) {
    return
  }

  const flushDelayMs = getRuntimeDevice() === 'Android' ? 260 : 120
  pendingTreeChangeFlushTimerId = window.setTimeout(() => {
    flushPendingTaskManagerLibraryTreeChanges()
  }, flushDelayMs)
}

function resolveSharedPathHint(paths: string[]): string | undefined {
  if (paths.length === 0) {
    return undefined
  }

  const [firstPath, ...restPaths] = paths.map((pathValue) => normalizeFilesystemPath(pathValue))
  let sharedSegments = firstPath.split('/').filter(Boolean)

  for (const currentPath of restPaths) {
    const currentSegments = currentPath.split('/').filter(Boolean)
    let sharedLength = 0
    while (
      sharedLength < sharedSegments.length
      && sharedLength < currentSegments.length
      && sharedSegments[sharedLength] === currentSegments[sharedLength]
    ) {
      sharedLength += 1
    }
    sharedSegments = sharedSegments.slice(0, sharedLength)
    if (sharedSegments.length === 0) {
      break
    }
  }

  if (sharedSegments.length === 0) {
    return paths[0]
  }

  if (/^[a-zA-Z]:$/.test(sharedSegments[0] ?? '')) {
    return `${sharedSegments[0]}/${sharedSegments.slice(1).join('/')}`.replace(/\/+$/, '')
  }

  return `/${sharedSegments.join('/')}`.replace(/\/+$/, '')
}

export function flushPendingTaskManagerLibraryTreeChanges(): void {
  if (typeof window === 'undefined') {
    pendingTreeChangeHints.clear()
    pendingTreeChangeFlushTimerId = null
    return
  }

  if (pendingTreeChangeFlushTimerId !== null) {
    window.clearTimeout(pendingTreeChangeFlushTimerId)
    pendingTreeChangeFlushTimerId = null
  }

  if (pendingTreeChangeHints.size === 0) {
    return
  }

  const pathHints = Array.from(pendingTreeChangeHints)
  pendingTreeChangeHints.clear()
  dispatchLibraryTreeChanged({
    vaultPath: activeTaskManagerVaultRef?.path,
    pathHint: resolveSharedPathHint(pathHints),
  })
}

async function readMarkdownFilesFromPaths(
  filePaths: string[],
  concurrency: number,
): Promise<MarkdownFileDocument[]> {
  const normalizedConcurrency = Math.max(1, concurrency)
  const documents: MarkdownFileDocument[] = []
  let nextIndex = 0

  const worker = async () => {
    while (true) {
      const currentIndex = nextIndex
      nextIndex += 1
      if (currentIndex >= filePaths.length) {
        return
      }

      const filePath = filePaths[currentIndex]
      const result = await readTextFile(filePath, {
        androidDirectoryUri: resolveAndroidDirectoryUri(filePath),
      })
      if (!result.ok) {
        continue
      }

      documents.push({
        path: normalizeFilesystemPath(filePath),
        content: result.content,
      })
    }
  }

  await Promise.all(Array.from({ length: Math.min(normalizedConcurrency, filePaths.length) }, () => worker()))
  return documents.sort((left, right) => left.path.localeCompare(right.path, 'es'))
}

export async function pickVaultDirectory(): Promise<TaskManagerVaultRef & { name: string } | null> {
  try {
    const selected = await pickDirectory('Seleccionar vault')
    if (!selected) {
      return null
    }

    const normalizedPath = normalizeFilesystemPath(selected.path)
    const name = getPathBaseName(normalizedPath)
    return {
      path: normalizedPath,
      name,
      androidTreeUri: typeof selected.uri === 'string' && selected.uri.trim()
        ? selected.uri
        : undefined,
    }
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
    if (getRuntimeDevice() === 'Android') {
      const vaultRef = activeTaskManagerVaultRef
      if (vaultRef && isNestedPath(vaultRef.path, directoryPath)) {
        const normalizedDirectoryPath = normalizeFilesystemPath(directoryPath).replace(/[\\/]+$/, '')
        const normalizedVaultPath = normalizeFilesystemPath(vaultRef.path).replace(/[\\/]+$/, '')
        const subtreeNodes = await readLibraryTree(normalizedDirectoryPath, {
          androidDirectoryUri: resolveAndroidDirectoryUri(normalizedDirectoryPath) ?? vaultRef.androidTreeUri,
        })

        const collectedMarkdownPaths: string[] = []
        collectMarkdownPathsFromTree(subtreeNodes, collectedMarkdownPaths)

        if (collectedMarkdownPaths.length === 0 && normalizedDirectoryPath !== normalizedVaultPath) {
          const rootTree = await readLibraryTree(vaultRef.path, {
            androidDirectoryUri: vaultRef.androidTreeUri,
          })
          collectMarkdownPathsFromTree(rootTree, collectedMarkdownPaths)
        }

        const filteredMarkdownPaths = Array.from(new Set(collectedMarkdownPaths))
          .filter((filePath) => (
            normalizedDirectoryPath === normalizedVaultPath
            || isNestedPath(normalizedDirectoryPath, filePath)
          ))
          .sort((left, right) => left.localeCompare(right, 'es'))

        return await readMarkdownFilesFromPaths(filteredMarkdownPaths, 6)
      }
    }

    return await readMarkdownDocuments(normalizeFilesystemPath(directoryPath))
  } catch (error) {
    console.error('[task-manager] read_markdown_files failed', error)
    return []
  }
}

export async function directoryExists(directoryPath: string): Promise<boolean> {
  const normalizedPath = normalizeFilesystemPath(directoryPath)
  if (!normalizedPath.trim()) {
    return false
  }

  try {
    const exists = await pathExists(normalizedPath, {
      androidDirectoryUri: resolveAndroidDirectoryUri(normalizedPath),
    })
    if (!exists) {
      return false
    }

    return await isDirectoryPath(normalizedPath, {
      androidDirectoryUri: resolveAndroidDirectoryUri(normalizedPath),
    })
  } catch (error) {
    console.error('[task-manager] directory_exists failed', error)
    return false
  }
}

export async function readFileContent(filePath: string): Promise<ReadLibraryFileResult> {
  const normalizedPath = normalizeFilesystemPath(filePath)

  try {
    const result = await readTextFile(normalizedPath, {
      androidDirectoryUri: resolveAndroidDirectoryUri(normalizedPath),
    })
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
    const result = await writeTextFile(normalizedPath, content, {
      androidDirectoryUri: resolveAndroidDirectoryUri(normalizedPath),
    })
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
      {
        androidDirectoryUri: resolveAndroidDirectoryUri(parentDirectoryPath),
      },
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
      {
        androidDirectoryUri: resolveAndroidDirectoryUri(parentDirectoryPath),
      },
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
    }, {
      androidDirectoryUri: resolveAndroidDirectoryUri(normalizedPath),
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
    }, {
      androidDirectoryUri: resolveAndroidDirectoryUri(normalizedPath),
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
    }, {
      androidDirectoryUri: resolveAndroidDirectoryUri(normalizedTargetDirectoryPath)
        ?? resolveAndroidDirectoryUri(normalizedSourcePath),
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
