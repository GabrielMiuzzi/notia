import {
  CANCELLED_TASKS_FOLDER,
  DEFAULT_BOARD_NAME,
  FINISHED_TASKS_FOLDER,
  POMODORO_LOG_BASENAME,
  TASK_MANAGER_MUTATION_JOURNAL_FILE,
  TASK_MANAGER_SHARED_METADATA_FILE,
  TASKS_ROOT_FOLDER,
} from '../constants/taskManagerConstants'
import { resolveTaskMoveTarget, resolveUniquePath } from '../engines/completionEngine'
import { parseMarkdownFrontmatter, rebuildTaskChildLinks, rebaseMarkdownFrontmatter, syncTaskTypeTags, updateMarkdownFrontmatter } from '../engines/frontmatterEngine'
import {
  appendPomodoroLogEntry,
  deletePomodoroLogEntry,
  readPomodoroLogEntries,
  type AppendPomodoroLogEntryInput,
} from '../engines/pomodoroLogEngine'
import { buildRebalancedEndDates } from '../engines/scheduleEngine'
import { buildBoardTaskIndexContent, buildRootTaskIndexContent, CANCELLED_TASK_INDEX_PATH, FINISHED_TASK_INDEX_PATH, getBoardTaskIndexPath, ROOT_TASK_INDEX_PATH } from '../engines/taskIndexEngine'
import { buildTaskContent, getBoardFolder, getBoardSubtasksFolder, getTasks, isTaskMarkdownFile, resolveNewTaskOrder, resolveTaskEndDate, resolveTaskPath } from '../engines/taskEngine'
import type {
  Board,
  MarkdownFileDocument,
  PomodoroLogEntry,
  TaskFormData,
  TaskItem,
} from '../types/taskManagerTypes'
import { normalizeFilesystemPath } from '../../../utils/files/normalizeFilesystemPath'
import { getBaseName, getBasenameWithoutExtension, getParentDirectory, toAbsoluteVaultPath, toRelativeVaultPath } from '../utils/path'
import { createMarkdownFile, deleteEntry, directoryExists, ensureFolderPath, moveEntry, readFileContent, readMarkdownFiles, renameEntry, taskManagerPathExists, writeFileContent } from './vaultRuntime'
import { listPendingTaskManagerMutations } from './taskManagerMutationJournal'

const ALTERNATE_TASKS_ROOT_FOLDER = 'task-manager'
const forcedTasksRootInsideVaultPaths = new Set<string>()

interface TaskWorkspaceRuntimeRoot {
  folder: string
  atVaultRoot: boolean
  rootPath: string
  toRuntimeRelativePath: (relativePath: string) => string
  toCanonicalRelativePath: (relativePath: string) => string
  toAbsolutePath: (relativePath: string) => string
}

export interface TaskManagerSnapshot {
  documents: MarkdownFileDocument[]
  tasks: TaskItem[]
  pomodoroEntries: PomodoroLogEntry[]
}

const MAX_PUBLICATION_CHANGED_PATHS = 32

/**
 * Returns logical Markdown paths whose persisted source changed between two
 * snapshots. The list is only an invalidation hint; the next snapshot remains
 * the source of truth and the publication server applies its own scope filter.
 */
export function resolveTaskManagerSnapshotChangedPaths(
  previousSnapshot: TaskManagerSnapshot,
  nextSnapshot: TaskManagerSnapshot,
): string[] {
  const previousDocuments = new Map(previousSnapshot.documents.map((document) => [document.path, document.content]))
  const nextDocuments = new Map(nextSnapshot.documents.map((document) => [document.path, document.content]))
  const paths = new Set<string>([
    ...previousDocuments.keys(),
    ...nextDocuments.keys(),
  ])

  const changedPaths = Array.from(paths)
    .filter((path) => previousDocuments.get(path) !== nextDocuments.get(path))
    .sort((left, right) => left.localeCompare(right))
  return changedPaths.length <= MAX_PUBLICATION_CHANGED_PATHS
    ? changedPaths
    : []
}

async function resolveRuntimeTasksRoot(
  vaultPath: string,
): Promise<{ folder: string; atVaultRoot: boolean }> {
  const normalizedVaultPath = normalizeVaultPathKey(vaultPath)
  const forceInsideVault = forcedTasksRootInsideVaultPaths.has(normalizedVaultPath)
  if (typeof window !== 'undefined'
    && normalizedVaultPath.toLowerCase() === 'published-vault'
    && window.__NOTIA_PUBLISHED_TASK_ROOT_AT_VAULT__ === true) {
    return {
      folder: TASKS_ROOT_FOLDER,
      atVaultRoot: true,
    }
  }
  const vaultBasename = getBaseName(vaultPath).trim().toLowerCase()
  if (!forceInsideVault && (vaultBasename === TASKS_ROOT_FOLDER || vaultBasename === ALTERNATE_TASKS_ROOT_FOLDER)) {
    return {
      folder: vaultBasename,
      atVaultRoot: true,
    }
  }

  const primaryRootPath = toAbsoluteVaultPath(vaultPath, TASKS_ROOT_FOLDER)
  if (await directoryExists(primaryRootPath)) {
    return {
      folder: TASKS_ROOT_FOLDER,
      atVaultRoot: false,
    }
  }

  const alternateRootPath = toAbsoluteVaultPath(vaultPath, ALTERNATE_TASKS_ROOT_FOLDER)
  if (await directoryExists(alternateRootPath)) {
    return {
      folder: ALTERNATE_TASKS_ROOT_FOLDER,
      atVaultRoot: false,
    }
  }

  return {
    folder: TASKS_ROOT_FOLDER,
    atVaultRoot: false,
  }
}

function normalizeVaultPathKey(vaultPath: string | null | undefined): string {
  return normalizeFilesystemPath(vaultPath ?? '').trim().replace(/[\\/]+$/, '')
}

async function resolveTaskWorkspaceRuntimeRoot(vaultPath: string): Promise<TaskWorkspaceRuntimeRoot> {
  const normalizedVaultPath = normalizeVaultPathKey(vaultPath)
  const runtimeRoot = await resolveRuntimeTasksRoot(normalizedVaultPath)

  const toRuntimeRelativePath = (relativePath: string): string => {
    if (runtimeRoot.atVaultRoot) {
      if (relativePath === TASKS_ROOT_FOLDER || relativePath === ALTERNATE_TASKS_ROOT_FOLDER) {
        return ''
      }

      if (relativePath.startsWith(`${TASKS_ROOT_FOLDER}/`)) {
        return relativePath.slice(`${TASKS_ROOT_FOLDER}/`.length)
      }

      if (relativePath.startsWith(`${ALTERNATE_TASKS_ROOT_FOLDER}/`)) {
        return relativePath.slice(`${ALTERNATE_TASKS_ROOT_FOLDER}/`.length)
      }

      return relativePath
    }

    if (runtimeRoot.folder === TASKS_ROOT_FOLDER) {
      return relativePath
    }

    if (relativePath === TASKS_ROOT_FOLDER) {
      return runtimeRoot.folder
    }

    if (relativePath.startsWith(`${TASKS_ROOT_FOLDER}/`)) {
      return `${runtimeRoot.folder}/${relativePath.slice(`${TASKS_ROOT_FOLDER}/`.length)}`
    }

    return relativePath
  }

  const toCanonicalRelativePath = (relativePath: string): string => {
    if (runtimeRoot.atVaultRoot) {
      const normalizedPath = relativePath.trim().replace(/^\/+/, '')
      if (!normalizedPath) {
        return TASKS_ROOT_FOLDER
      }

      if (normalizedPath === TASKS_ROOT_FOLDER || normalizedPath.startsWith(`${TASKS_ROOT_FOLDER}/`)) {
        return normalizedPath
      }

      return `${TASKS_ROOT_FOLDER}/${normalizedPath}`
    }

    if (runtimeRoot.folder === TASKS_ROOT_FOLDER) {
      return relativePath
    }

    if (relativePath === runtimeRoot.folder) {
      return TASKS_ROOT_FOLDER
    }

    if (relativePath.startsWith(`${runtimeRoot.folder}/`)) {
      return `${TASKS_ROOT_FOLDER}/${relativePath.slice(`${runtimeRoot.folder}/`.length)}`
    }

    return relativePath
  }

  return {
    folder: runtimeRoot.folder,
    atVaultRoot: runtimeRoot.atVaultRoot,
    rootPath: runtimeRoot.atVaultRoot
      ? normalizedVaultPath
      : toAbsoluteVaultPath(normalizedVaultPath, runtimeRoot.folder),
    toRuntimeRelativePath,
    toCanonicalRelativePath,
    toAbsolutePath: (relativePath: string) => {
      const runtimeRelativePath = toRuntimeRelativePath(relativePath)
      return runtimeRelativePath
        ? toAbsoluteVaultPath(normalizedVaultPath, runtimeRelativePath)
        : normalizedVaultPath
    },
  }
}

export function setTaskManagerRuntimeRootPolicy(vaultPath: string | null, options: {
  forceInsideVault: boolean
}): void {
  const normalizedVaultPath = normalizeVaultPathKey(vaultPath)
  if (!normalizedVaultPath) {
    return
  }

  if (options.forceInsideVault) {
    forcedTasksRootInsideVaultPaths.add(normalizedVaultPath)
    return
  }

  forcedTasksRootInsideVaultPaths.delete(normalizedVaultPath)
}

export async function ensureTaskWorkspace(vaultPath: string, boards: Board[]): Promise<void> {
  const runtimeRoot = await resolveTaskWorkspaceRuntimeRoot(vaultPath)

  await runWorkspaceStep('ensure-root-folder', () => ensureFolderPath(vaultPath, runtimeRoot.toRuntimeRelativePath(TASKS_ROOT_FOLDER)))
  await runWorkspaceStep('ensure-finished-folder', () => ensureFolderPath(vaultPath, runtimeRoot.toRuntimeRelativePath(FINISHED_TASKS_FOLDER)))
  await runWorkspaceStep('ensure-finished-subtasks-folder', () => ensureFolderPath(vaultPath, runtimeRoot.toRuntimeRelativePath(`${FINISHED_TASKS_FOLDER}/subTasks`)))
  await runWorkspaceStep('ensure-cancelled-folder', () => ensureFolderPath(vaultPath, runtimeRoot.toRuntimeRelativePath(CANCELLED_TASKS_FOLDER)))
  await runWorkspaceStep('ensure-cancelled-subtasks-folder', () => ensureFolderPath(vaultPath, runtimeRoot.toRuntimeRelativePath(`${CANCELLED_TASKS_FOLDER}/subTasks`)))

  const boardNames = Array.from(new Set([DEFAULT_BOARD_NAME, ...boards.map((board) => board.name.trim().toLowerCase())]))
  for (const boardName of boardNames) {
    await runWorkspaceStep(`ensure-board-workspace:${boardName}`, () => ensureBoardWorkspace(vaultPath, boardName))
  }

  await runWorkspaceStep('ensure-pomodoro-log-file', () => ensurePomodoroLogFile(runtimeRoot))
  await runWorkspaceStep('sync-indexes-and-metadata', () => syncTaskIndexesAndMetadata(vaultPath, boardNames, boards))
  await runWorkspaceStep('recover-pending-mutations', async () => {
    const journalPath = await resolveTaskManagerMutationJournalPath(vaultPath)
    const pendingMutations = await listPendingTaskManagerMutations(journalPath)
    if (pendingMutations.length > 0) {
      console.warn('[task-manager] hay operaciones colaborativas pendientes de recuperación', {
        count: pendingMutations.length,
      })
    }
  })
}

export async function cleanupEmptyWorkspaceBoards(vaultPath: string, boardNames: string[]): Promise<void> {
  const runtimeRoot = await resolveTaskWorkspaceRuntimeRoot(vaultPath)

  const normalizedBoards = Array.from(new Set(boardNames.map((boardName) => normalizeBoardName(boardName))))
  for (const boardName of normalizedBoards) {
    if (boardName === DEFAULT_BOARD_NAME || boardName === 'finished' || boardName === 'cancelled') {
      continue
    }

    const result = await deleteEntry(
      runtimeRoot.toAbsolutePath(getBoardFolder(boardName)),
    )
    if (!result.ok && !isNotFoundError(result.error)) {
      console.warn('[task-manager] cleanup board skipped', { boardName, error: result.error })
    }
  }
}

export async function loadTaskManagerSnapshot(vaultPath: string): Promise<TaskManagerSnapshot> {
  const runtimeRoot = await resolveTaskWorkspaceRuntimeRoot(vaultPath)
  const absoluteDocuments = await readMarkdownFiles(runtimeRoot.rootPath)
  const relativeDocuments = absoluteDocuments.map((document) => ({
    path: runtimeRoot.toCanonicalRelativePath(toRelativeVaultPath(vaultPath, document.path)),
    content: document.content,
  }))

  const tasks = getTasks(relativeDocuments)
  const pomodoroEntries = extractPomodoroEntries(relativeDocuments)

  return {
    documents: relativeDocuments,
    tasks,
    pomodoroEntries,
  }
}

export async function resolveTaskManagerSharedMetadataPath(vaultPath: string): Promise<string> {
  const runtimeRoot = await resolveTaskWorkspaceRuntimeRoot(vaultPath)
  return runtimeRoot.toAbsolutePath(`${TASKS_ROOT_FOLDER}/${TASK_MANAGER_SHARED_METADATA_FILE}`)
}

export async function resolveTaskManagerMutationJournalPath(vaultPath: string): Promise<string> {
  const metadataPath = await resolveTaskManagerSharedMetadataPath(vaultPath)
  if (metadataPath.endsWith(TASK_MANAGER_SHARED_METADATA_FILE)) {
    return `${metadataPath.slice(0, -TASK_MANAGER_SHARED_METADATA_FILE.length)}${TASK_MANAGER_MUTATION_JOURNAL_FILE}`
  }
  return `${metadataPath}.${TASK_MANAGER_MUTATION_JOURNAL_FILE}`
}

export async function loadTaskManagerSnapshotForChangedPaths(
  vaultPath: string,
  previousSnapshot: TaskManagerSnapshot,
  changedPaths: string[],
): Promise<TaskManagerSnapshot> {
  const normalizedChangedPaths = Array.from(new Set(changedPaths
    .map((path) => normalizeFilesystemPath(path).trim())
    .filter(Boolean)))
  if (normalizedChangedPaths.length === 0 || normalizedChangedPaths.length > MAX_PUBLICATION_CHANGED_PATHS) {
    return loadTaskManagerSnapshot(vaultPath)
  }

  const normalizedVaultPath = normalizeFilesystemPath(vaultPath).replace(/[\\/]+$/, '')
  const acceptsPublicationAlias = normalizedVaultPath.toLowerCase() === 'published-vault'
  const isPathReadableFromRuntime = normalizedChangedPaths.every((path) => (
    path === normalizedVaultPath
    || path.startsWith(`${normalizedVaultPath}/`)
    || (acceptsPublicationAlias && (path === 'published-vault' || path.startsWith('published-vault/')))
  ))
  if (!isPathReadableFromRuntime) {
    return loadTaskManagerSnapshot(vaultPath)
  }

  const runtimeRoot = await resolveTaskWorkspaceRuntimeRoot(vaultPath)
  const documentsByPath = new Map(previousSnapshot.documents.map((document) => [document.path, document.content]))
  for (const changedPath of normalizedChangedPaths) {
    const relativePath = changedPath.startsWith(`${normalizedVaultPath}/`)
      ? changedPath.slice(normalizedVaultPath.length + 1)
      : changedPath === normalizedVaultPath
        ? ''
        : changedPath
    if (
      !runtimeRoot.atVaultRoot
      && relativePath !== runtimeRoot.folder
      && !relativePath.startsWith(`${runtimeRoot.folder}/`)
    ) {
      continue
    }
    const canonicalPath = runtimeRoot.toCanonicalRelativePath(relativePath)
    const result = await readFileContent(changedPath)
    if (!result.ok) {
      if (await taskManagerPathExists(changedPath)) {
        return loadTaskManagerSnapshot(vaultPath)
      }
      documentsByPath.delete(canonicalPath)
      continue
    }
    documentsByPath.set(canonicalPath, result.content)
  }

  const documents = Array.from(documentsByPath.entries())
    .map(([path, content]) => ({ path, content }))
    .sort((left, right) => left.path.localeCompare(right.path, 'es'))
  return {
    documents,
    tasks: getTasks(documents),
    pomodoroEntries: extractPomodoroEntries(documents),
  }
}

export async function createTask(vaultPath: string, formData: TaskFormData, tasks: TaskItem[]): Promise<string> {
  const runtimeRoot = await resolveTaskWorkspaceRuntimeRoot(vaultPath)

  const order = resolveNewTaskOrder(tasks, formData)
  const normalizedFormData: TaskFormData = {
    ...formData,
    endDate: resolveTaskEndDate(formData.endDate, formData.estimatedHours),
  }
  const desiredPath = resolveTaskPath(vaultPath, normalizedFormData.title, normalizedFormData.board, normalizedFormData.parentTaskName)
  const relativeDesiredPath = toRelativeVaultPath(vaultPath, desiredPath)
  const existingPaths = new Set(tasks.map((task) => task.filePath))

  await ensureFolderPath(
    vaultPath,
    runtimeRoot.toRuntimeRelativePath(
      normalizedFormData.parentTaskName.trim() ? getBoardSubtasksFolder(normalizedFormData.board) : getBoardFolder(normalizedFormData.board),
    ),
  )

  let uniqueRelativePath = resolveUniquePath(relativeDesiredPath, existingPaths)
  let absolutePath = runtimeRoot.toAbsolutePath(uniqueRelativePath)

  // Guard against collisions with non-task markdown files that are outside `tasks`.
  let createResult = await createMarkdownFile(getParentDirectory(absolutePath), getBaseName(absolutePath))
  let collisionIndex = 1
  while (!createResult.ok && isAlreadyExistsError(createResult.error)) {
    const baseName = getBasenameWithoutExtension(uniqueRelativePath)
    const parentPath = getParentDirectory(uniqueRelativePath)
    uniqueRelativePath = `${parentPath}/${baseName}-${collisionIndex}.md`
    absolutePath = runtimeRoot.toAbsolutePath(uniqueRelativePath)
    createResult = await createMarkdownFile(getParentDirectory(absolutePath), getBaseName(absolutePath))
    collisionIndex += 1
  }

  if (!createResult.ok) {
    throw new Error(createResult.error || 'No se pudo crear la tarea.')
  }

  const writeResult = await writeFileContent(absolutePath, buildTaskContent(normalizedFormData, order))
  if (!writeResult.ok) {
    throw new Error(writeResult.error || 'No se pudo escribir la tarea.')
  }
  return uniqueRelativePath
}

export async function updateTaskFrontmatter(
  vaultPath: string,
  taskPath: string,
  updates: Record<string, unknown>,
  options?: { baseContent?: string },
): Promise<void> {
  const runtimeRoot = await resolveTaskWorkspaceRuntimeRoot(vaultPath)

  const absolutePath = runtimeRoot.toAbsolutePath(taskPath)
  const readResult = await readFileContent(absolutePath)
  if (!readResult.ok) {
    throw new Error(readResult.error || 'No se pudo leer la tarea.')
  }

  const rebased = options?.baseContent === undefined
    ? { ok: true as const, content: updateMarkdownFrontmatter(readResult.content, updates) }
    : rebaseMarkdownFrontmatter(options.baseContent, readResult.content, updates)
  if (!rebased.ok) {
    throw new Error(`CONFLICT: campos modificados por otra persona (${rebased.conflictingFields.join(', ')}).`)
  }

  const nextContent = rebased.content
  const writeResult = await writeFileContent(absolutePath, nextContent, readResult.revision)
  if (!writeResult.ok) {
    throw new Error(writeResult.error || 'No se pudo actualizar la tarea.')
  }
}

export async function moveTaskByState(vaultPath: string, task: TaskItem, nextState: string, existingRelativePaths: Set<string>): Promise<void> {
  const runtimeRoot = await resolveTaskWorkspaceRuntimeRoot(vaultPath)

  const snapshot = await loadTaskManagerSnapshot(vaultPath)
  const sourceTask = snapshot.tasks.find((candidate) => candidate.filePath === task.filePath) ?? task
  const descendants = collectTaskDescendants(sourceTask, snapshot.tasks)
  const tasksToMove = [sourceTask, ...descendants]
  const knownPaths = new Set([
    ...existingRelativePaths,
    ...snapshot.tasks.map((item) => item.filePath),
  ])

  for (const taskToMove of tasksToMove) {
    const targetFolder = resolveTaskMoveTarget(taskToMove, nextState)
    await ensureFolderPath(vaultPath, runtimeRoot.toRuntimeRelativePath(targetFolder))

    const finalPath = await moveSingleTaskPath(runtimeRoot, taskToMove.filePath, targetFolder, knownPaths)
    await updateTaskFrontmatter(vaultPath, finalPath, { estado: nextState })
  }
}

export async function deleteTask(vaultPath: string, taskPath: string): Promise<void> {
  const runtimeRoot = await resolveTaskWorkspaceRuntimeRoot(vaultPath)

  const snapshot = await loadTaskManagerSnapshot(vaultPath)
  const sourceTask = snapshot.tasks.find((task) => task.filePath === taskPath)

  const descendants = sourceTask
    ? collectTaskDescendants(sourceTask, snapshot.tasks)
    : []

  // Delete children first, then the requested task.
  const deletionOrder = [...descendants, ...(sourceTask ? [sourceTask] : [])].reverse()
  if (deletionOrder.length === 0) {
    deletionOrder.push({ filePath: taskPath } as TaskItem)
  }

  for (const task of deletionOrder) {
    const result = await deleteEntry(runtimeRoot.toAbsolutePath(task.filePath))
    if (!result.ok && !isNotFoundError(result.error)) {
      throw new Error(result.error || 'No se pudo borrar la tarea.')
    }
  }
}

export async function ensureBoardWorkspace(vaultPath: string, boardName: string): Promise<void> {
  const runtimeRoot = await resolveTaskWorkspaceRuntimeRoot(vaultPath)

  const normalizedBoardName = normalizeBoardName(boardName)
  await ensureFolderPath(vaultPath, runtimeRoot.toRuntimeRelativePath(getBoardFolder(normalizedBoardName)))
  await ensureFolderPath(vaultPath, runtimeRoot.toRuntimeRelativePath(getBoardSubtasksFolder(normalizedBoardName)))

  const indexPath = getBoardTaskIndexPath(normalizedBoardName)
  await ensureFile(runtimeRoot, indexPath, buildBoardTaskIndexContent([]))
}

export async function removeBoardWorkspace(vaultPath: string, boardName: string): Promise<void> {
  const runtimeRoot = await resolveTaskWorkspaceRuntimeRoot(vaultPath)

  const normalizedBoardName = normalizeBoardName(boardName)
  if (normalizedBoardName === DEFAULT_BOARD_NAME) {
    return
  }

  const result = await deleteEntry(
    runtimeRoot.toAbsolutePath(getBoardFolder(normalizedBoardName)),
  )
  if (!result.ok) {
    throw new Error(result.error || 'No se pudo eliminar el tablero.')
  }
}

export async function renameBoardWorkspace(vaultPath: string, currentBoardName: string, nextBoardName: string): Promise<void> {
  const runtimeRoot = await resolveTaskWorkspaceRuntimeRoot(vaultPath)

  const currentName = normalizeBoardName(currentBoardName)
  const nextName = normalizeBoardName(nextBoardName)
  if (currentName === nextName) {
    return
  }

  const currentPath = runtimeRoot.toAbsolutePath(getBoardFolder(currentName))
  const renameResult = await renameEntry(currentPath, nextName)
  if (!renameResult.ok) {
    throw new Error(renameResult.error || 'No se pudo renombrar el tablero.')
  }

  const snapshot = await loadTaskManagerSnapshot(vaultPath)
  for (const task of snapshot.tasks) {
    if (task.board !== currentName) {
      continue
    }

    await updateTaskFrontmatter(vaultPath, task.filePath, { tablero: nextName })
  }
}

export async function syncTaskIndexesAndMetadata(
  vaultPath: string,
  boardNamesInput: string[],
  boardConfigsInput: Board[] = [],
): Promise<void> {
  const runtimeRoot = await resolveTaskWorkspaceRuntimeRoot(vaultPath)
  const snapshot = await loadTaskManagerSnapshot(vaultPath)
  const documentsByPath = new Map(snapshot.documents.map((document) => [document.path, document.content]))
  const boardNamesFromDocuments = extractBoardNamesFromDocuments(snapshot.documents)
  const boardConfigsByName = new Map(
    boardConfigsInput.map((board) => [normalizeBoardName(board.name), board]),
  )

  const boardNames = Array.from(
    new Set([
      DEFAULT_BOARD_NAME,
      ...boardNamesInput.map((boardName) => normalizeBoardName(boardName)),
      ...boardNamesFromDocuments,
      ...snapshot.tasks
        .filter((task) => !task.filePath.startsWith(`${FINISHED_TASKS_FOLDER}/`) && !task.filePath.startsWith(`${CANCELLED_TASKS_FOLDER}/`))
        .map((task) => normalizeBoardName(task.board)),
    ]),
  )

  const rootTaskIndexContent = buildRootTaskIndexContent(boardNames)
  const finishedTaskIndexContent = buildBoardTaskIndexContent([])
  const cancelledTaskIndexContent = buildBoardTaskIndexContent([])
  documentsByPath.set(
    ROOT_TASK_INDEX_PATH,
    await ensureFile(runtimeRoot, ROOT_TASK_INDEX_PATH, rootTaskIndexContent),
  )
  documentsByPath.set(
    FINISHED_TASK_INDEX_PATH,
    await ensureFile(runtimeRoot, FINISHED_TASK_INDEX_PATH, finishedTaskIndexContent),
  )
  documentsByPath.set(
    CANCELLED_TASK_INDEX_PATH,
    await ensureFile(runtimeRoot, CANCELLED_TASK_INDEX_PATH, cancelledTaskIndexContent),
  )

  await writeIfChanged(runtimeRoot, ROOT_TASK_INDEX_PATH, rootTaskIndexContent, documentsByPath)

  for (const boardName of boardNames) {
    const boardIndexPath = getBoardTaskIndexPath(boardName)
    const taskNames = snapshot.documents
      .filter((document) => document.path.startsWith(`${TASKS_ROOT_FOLDER}/${boardName}/`))
      .filter((document) => !document.path.startsWith(`${TASKS_ROOT_FOLDER}/${boardName}/subTasks/`))
      .filter((document) => document.path !== boardIndexPath)
      .filter((document) => !document.path.endsWith(`${boardName}TaskIndex.md`))
      .map((document) => getBasenameWithoutExtension(document.path))

    const boardIndexContent = buildBoardTaskIndexContent(taskNames)
    documentsByPath.set(
      boardIndexPath,
      await ensureFile(runtimeRoot, boardIndexPath, boardIndexContent),
    )
    await writeIfChanged(runtimeRoot, boardIndexPath, boardIndexContent, documentsByPath)
  }

  const finishedTaskNames = snapshot.documents
    .filter((document) => document.path.startsWith(`${FINISHED_TASKS_FOLDER}/`))
    .filter((document) => document.path !== FINISHED_TASK_INDEX_PATH)
    .map((document) => getBasenameWithoutExtension(document.path))

  const cancelledTaskNames = snapshot.documents
    .filter((document) => document.path.startsWith(`${CANCELLED_TASKS_FOLDER}/`))
    .filter((document) => document.path !== CANCELLED_TASK_INDEX_PATH)
    .map((document) => getBasenameWithoutExtension(document.path))

  await writeIfChanged(runtimeRoot, FINISHED_TASK_INDEX_PATH, buildBoardTaskIndexContent(finishedTaskNames), documentsByPath)
  await writeIfChanged(runtimeRoot, CANCELLED_TASK_INDEX_PATH, buildBoardTaskIndexContent(cancelledTaskNames), documentsByPath)

  for (const boardName of boardNames) {
    const boardTasks = snapshot.tasks
      .filter((task) => !task.parentTaskName.trim())
      .filter((task) => normalizeBoardName(task.board) === boardName)
      .filter((task) => task.state !== 'Finalizada' && task.state !== 'Cancelada')

    const endDateUpdates = buildRebalancedEndDates(boardTasks, {
      activityHoursPerDay: boardConfigsByName.get(boardName)?.activityHoursPerDay ?? 24,
    })

    for (const update of endDateUpdates) {
      const currentTaskContent = documentsByPath.get(update.taskPath)
      if (!currentTaskContent) {
        continue
      }

      const nextTaskContent = updateMarkdownFrontmatter(currentTaskContent, { fechaFin: update.endDate })
      await writeIfChanged(runtimeRoot, update.taskPath, nextTaskContent, documentsByPath)
    }
  }

  const taskDocuments = snapshot.documents.filter((document) => isTaskMarkdownFile(document.path))
  const childLinksByPath = rebuildTaskChildLinks(taskDocuments)

  for (const document of snapshot.documents) {
    const latestContent = documentsByPath.get(document.path) ?? document.content
    let nextContent = syncTaskTypeTags(document.path, latestContent)

    if (isTaskMarkdownFile(document.path)) {
      nextContent = updateMarkdownFrontmatter(nextContent, {
        childs: childLinksByPath.get(document.path) ?? [],
      })
    }

    await writeIfChanged(runtimeRoot, document.path, nextContent, documentsByPath)
  }
}

export async function appendPomodoroEntry(vaultPath: string, input: AppendPomodoroLogEntryInput): Promise<void> {
  const runtimeRoot = await resolveTaskWorkspaceRuntimeRoot(vaultPath)

  await ensurePomodoroLogFile(runtimeRoot)
  const logPath = `${TASKS_ROOT_FOLDER}/${POMODORO_LOG_BASENAME}.md`
  const absolutePath = runtimeRoot.toAbsolutePath(logPath)
  const readResult = await readFileContent(absolutePath)
  if (!readResult.ok) {
    throw new Error(readResult.error || 'No se pudo leer el registro de pomodoro.')
  }

  const nextContent = appendPomodoroLogEntry(readResult.content, input)
  const writeResult = await writeFileContent(absolutePath, nextContent, readResult.revision)
  if (!writeResult.ok) {
    throw new Error(writeResult.error || 'No se pudo guardar el registro de pomodoro.')
  }
}

export async function readPomodoroEntries(vaultPath: string): Promise<PomodoroLogEntry[]> {
  const runtimeRoot = await resolveTaskWorkspaceRuntimeRoot(vaultPath)

  await ensurePomodoroLogFile(runtimeRoot)
  const logPath = `${TASKS_ROOT_FOLDER}/${POMODORO_LOG_BASENAME}.md`
  const result = await readFileContent(runtimeRoot.toAbsolutePath(logPath))
  if (!result.ok) {
    return []
  }

  return readPomodoroLogEntries(result.content)
}

export async function deletePomodoroEntry(vaultPath: string, entryId: string): Promise<boolean> {
  const runtimeRoot = await resolveTaskWorkspaceRuntimeRoot(vaultPath)

  await ensurePomodoroLogFile(runtimeRoot)
  const logPath = `${TASKS_ROOT_FOLDER}/${POMODORO_LOG_BASENAME}.md`
  const absolutePath = runtimeRoot.toAbsolutePath(logPath)

  const readResult = await readFileContent(absolutePath)
  if (!readResult.ok) {
    return false
  }

  const result = deletePomodoroLogEntry(readResult.content, entryId)
  if (!result.ok) {
    return false
  }

  const writeResult = await writeFileContent(absolutePath, result.content, readResult.revision)
  return writeResult.ok
}

async function ensurePomodoroLogFile(runtimeRoot: TaskWorkspaceRuntimeRoot): Promise<void> {
  const logPath = `${TASKS_ROOT_FOLDER}/${POMODORO_LOG_BASENAME}.md`
  await ensureFile(runtimeRoot, logPath, '')
}

async function ensureFile(runtimeRoot: TaskWorkspaceRuntimeRoot, relativePath: string, content: string): Promise<string> {
  const absolutePath = runtimeRoot.toAbsolutePath(relativePath)
  const existing = await readFileContent(absolutePath)
  if (existing.ok) {
    return existing.content
  }

  const createResult = await createMarkdownFile(getParentDirectory(absolutePath), getBaseName(absolutePath))
  if (!createResult.ok && !isAlreadyExistsError(createResult.error)) {
    throw new Error(createResult.error || `No se pudo crear ${relativePath}`)
  }

  const writeResult = await writeFileContent(absolutePath, content)
  if (!writeResult.ok) {
    throw new Error(writeResult.error || `No se pudo escribir ${relativePath}`)
  }
  return content
}

async function writeIfChanged(
  runtimeRoot: TaskWorkspaceRuntimeRoot,
  relativePath: string,
  nextContent: string,
  currentContentsByPath: Map<string, string>,
): Promise<void> {
  const currentContent = currentContentsByPath.get(relativePath)
  if (typeof currentContent === 'string' && currentContent === nextContent) {
    return
  }

  const writeResult = await writeFileContent(
    runtimeRoot.toAbsolutePath(relativePath),
    nextContent,
  )
  if (!writeResult.ok) {
    throw new Error(writeResult.error || `No se pudo sincronizar ${relativePath}`)
  }

  currentContentsByPath.set(relativePath, nextContent)
}

function extractPomodoroEntries(documents: MarkdownFileDocument[]): PomodoroLogEntry[] {
  const logPath = `${TASKS_ROOT_FOLDER}/${POMODORO_LOG_BASENAME}.md`
  const logDocument = documents.find((document) => document.path === logPath)
  if (!logDocument) {
    return []
  }

  return readPomodoroLogEntries(logDocument.content)
}

function normalizeBoardName(boardName: string): string {
  const normalized = boardName.trim().toLowerCase()
  return normalized || DEFAULT_BOARD_NAME
}

function collectTaskDescendants(parentTask: TaskItem, tasks: TaskItem[]): TaskItem[] {
  const descendants: TaskItem[] = []
  const queue: TaskItem[] = [parentTask]
  const visited = new Set<string>([parentTask.filePath])

  while (queue.length > 0) {
    const current = queue.shift()
    if (!current) {
      continue
    }

    const currentTitle = current.title.trim().toLowerCase()
    const currentFileName = current.fileName.trim().toLowerCase()

    for (const candidate of tasks) {
      if (visited.has(candidate.filePath)) {
        continue
      }

      const parentReference = candidate.parentTaskName.trim().toLowerCase()
      if (!parentReference) {
        continue
      }

      if (parentReference !== currentTitle && parentReference !== currentFileName) {
        continue
      }

      visited.add(candidate.filePath)
      descendants.push(candidate)
      queue.push(candidate)
    }
  }

  return descendants
}

async function moveSingleTaskPath(
  runtimeRoot: TaskWorkspaceRuntimeRoot,
  currentRelativePath: string,
  targetFolder: string,
  knownPaths: Set<string>,
): Promise<string> {
  let nextRelativePath = currentRelativePath
  const targetRelativePath = `${targetFolder}/${getBaseName(currentRelativePath)}`

  knownPaths.delete(currentRelativePath)

  if (targetRelativePath !== currentRelativePath && knownPaths.has(targetRelativePath)) {
    const uniqueRelativePath = resolveUniquePath(targetRelativePath, knownPaths)
    const uniqueFileName = getBaseName(uniqueRelativePath)
    const renameResult = await renameEntry(
      runtimeRoot.toAbsolutePath(currentRelativePath),
      uniqueFileName,
    )
    if (!renameResult.ok) {
      throw new Error(renameResult.error || 'No se pudo preparar el movimiento de la tarea.')
    }

    nextRelativePath = `${getParentDirectory(currentRelativePath)}/${uniqueFileName}`
  }

  if (!nextRelativePath.startsWith(`${targetFolder}/`)) {
    const moveResult = await moveEntry(
      runtimeRoot.toAbsolutePath(nextRelativePath),
      runtimeRoot.toAbsolutePath(targetFolder),
    )
    if (!moveResult.ok) {
      throw new Error(moveResult.error || 'No se pudo mover la tarea.')
    }

    nextRelativePath = `${targetFolder}/${getBaseName(nextRelativePath)}`
  }

  knownPaths.add(nextRelativePath)
  return nextRelativePath
}

function extractBoardNamesFromDocuments(documents: MarkdownFileDocument[]): string[] {
  const boardNames = new Set<string>()

  for (const document of documents) {
    if (!document.path.startsWith(`${TASKS_ROOT_FOLDER}/`)) {
      continue
    }

    const segments = document.path.split('/').filter(Boolean)
    // Only treat real board content paths as board candidates:
    // task-mannager/<board>/<file>.md (or deeper), never root-level files.
    if (segments.length < 3) {
      continue
    }

    const boardName = normalizeBoardName(segments[1] ?? '')
    if (isReservedBoardName(boardName)) {
      continue
    }

    boardNames.add(boardName)
  }

  return Array.from(boardNames)
}

function isReservedBoardName(boardName: string): boolean {
  return boardName === 'finished' || boardName === 'cancelled'
}

function isAlreadyExistsError(error: string | undefined): boolean {
  if (!error) {
    return false
  }

  return error.toLowerCase().includes('already exists')
}

function isNotFoundError(error: string | undefined): boolean {
  if (!error) {
    return false
  }

  const normalized = error.toLowerCase()
  return normalized.includes('not found') || normalized.includes('no such file') || normalized.includes('does not exist')
}

export function resolveTaskFrontmatterForStateChange(task: TaskItem, nextState: string): Record<string, unknown> {
  if (nextState === 'Finalizada' || nextState === 'Cancelada') {
    return { estado: nextState }
  }

  const previousState = task.state
  if (previousState === 'Finalizada' || previousState === 'Cancelada') {
    return {
      estado: nextState,
      tablero: task.board,
      equipo: task.group,
    }
  }

  return { estado: nextState }
}

async function runWorkspaceStep(label: string, runner: () => Promise<void>): Promise<void> {
  try {
    await runner()
  } catch (error) {
    console.warn(`[task-manager] workspace step failed (${label})`, error)
  }
}

export function buildTaskEditPayload(
  existingTask: TaskItem,
  updates: Partial<{ title: string; detail: string; state: string; endDate: string; dynamicEndDate: boolean; group: string; priority: string; estimatedHours: number; parentTaskName: string }>,
): TaskFormData {
  return {
    title: updates.title ?? existingTask.title,
    detail: updates.detail ?? existingTask.detail,
    state: (updates.state as TaskFormData['state']) ?? existingTask.state,
    endDate: updates.endDate ?? existingTask.endDate,
    dynamicEndDate: updates.dynamicEndDate ?? existingTask.dynamicEndDate,
    board: existingTask.board,
    group: updates.group ?? existingTask.group,
    priority: (updates.priority as TaskFormData['priority']) ?? existingTask.priority,
    estimatedHours: updates.estimatedHours ?? existingTask.estimatedHours,
    parentTaskName: updates.parentTaskName ?? existingTask.parentTaskName,
  }
}

export async function updateTaskBody(vaultPath: string, taskPath: string, contentUpdater: (content: string) => string): Promise<void> {
  const runtimeRoot = await resolveTaskWorkspaceRuntimeRoot(vaultPath)

  const absolutePath = runtimeRoot.toAbsolutePath(taskPath)
  const readResult = await readFileContent(absolutePath)
  if (!readResult.ok) {
    throw new Error(readResult.error || 'No se pudo leer la tarea.')
  }

  const nextContent = contentUpdater(readResult.content)
  const writeResult = await writeFileContent(absolutePath, nextContent, readResult.revision)
  if (!writeResult.ok) {
    throw new Error(writeResult.error || 'No se pudo actualizar la tarea.')
  }
}

export async function readTaskMarkdownSource(vaultPath: string, taskPath: string): Promise<string> {
  const result = await readTaskMarkdownSourceWithRevision(vaultPath, taskPath)
  return result.content
}

export async function readTaskMarkdownSourceWithRevision(
  vaultPath: string,
  taskPath: string,
): Promise<{ content: string; revision?: string }> {
  const runtimeRoot = await resolveTaskWorkspaceRuntimeRoot(vaultPath)

  const absolutePath = runtimeRoot.toAbsolutePath(taskPath)
  const readResult = await readFileContent(absolutePath)
  if (!readResult.ok) {
    throw new Error(readResult.error || 'No se pudo leer el markdown de la tarea.')
  }

  return { content: readResult.content, revision: readResult.revision }
}

export async function writeTaskMarkdownSource(
  vaultPath: string,
  taskPath: string,
  content: string,
  expectedRevision?: string,
): Promise<void> {
  const runtimeRoot = await resolveTaskWorkspaceRuntimeRoot(vaultPath)

  const absolutePath = runtimeRoot.toAbsolutePath(taskPath)
  const writeResult = await writeFileContent(absolutePath, content, expectedRevision)
  if (!writeResult.ok) {
    throw new Error(writeResult.error || 'No se pudo guardar el markdown de la tarea.')
  }
}

export function parseTaskSource(content: string): { frontmatter: Record<string, unknown>; body: string } {
  const parsed = parseMarkdownFrontmatter(content)
  return {
    frontmatter: (parsed.frontmatter ?? {}) as Record<string, unknown>,
    body: parsed.body,
  }
}
