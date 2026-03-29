import type { NotiaLibrary } from '../../types/notia'
import { pathExists } from '../files/filesystemEngine'
import { createLibraryEntry } from '../libraries/libraryRuntime'
import { ensureChatLibraryStructure } from './chatLibraryStructure'
import { performLibraryEntryOperation } from '../libraries/libraryRuntime'
import { saveChatDocument } from './chatDocumentStorage'
import { resolveChatHistoryDirectoryPath, joinChatPath } from './chatLibraryStructure'

export interface CreateChatFileInput {
  longTermMemoryEnabled: boolean
  contextMemoryEnabled: boolean
  contextMemoryMessageCount: number
}

function padNumber(value: number): string {
  return String(value).padStart(2, '0')
}

function buildTimestampParts(now: Date): {
  fileStamp: string
  readableStamp: string
} {
  const year = now.getFullYear()
  const month = padNumber(now.getMonth() + 1)
  const day = padNumber(now.getDate())
  const hours = padNumber(now.getHours())
  const minutes = padNumber(now.getMinutes())
  const seconds = padNumber(now.getSeconds())

  return {
    fileStamp: `${year}-${month}-${day}-${hours}-${minutes}-${seconds}`,
    readableStamp: `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`,
  }
}

async function resolveAvailableChatFileName(chatDirectoryPath: string): Promise<{
  fileName: string
  readableStamp: string
}> {
  const { fileStamp, readableStamp } = buildTimestampParts(new Date())
  const baseName = `Chat-${fileStamp}`
  const initialFileName = `${baseName}.md`
  if (!(await pathExists(joinChatPath(chatDirectoryPath, initialFileName)))) {
    return { fileName: initialFileName, readableStamp }
  }

  let suffix = 2
  while (suffix < 10_000) {
    const candidateFileName = `${baseName}-${suffix}.md`
    if (!(await pathExists(joinChatPath(chatDirectoryPath, candidateFileName)))) {
      return { fileName: candidateFileName, readableStamp }
    }
    suffix += 1
  }

  throw new Error('No se pudo reservar un nombre temporal para el chat.')
}

export async function createChatDraftFile(
  library: NotiaLibrary,
  config: CreateChatFileInput,
): Promise<{ filePath: string }> {
  await ensureChatLibraryStructure(library)

  const chatDirectoryPath = resolveChatHistoryDirectoryPath(library.path)
  const { fileName, readableStamp } = await resolveAvailableChatFileName(chatDirectoryPath)
  const filePath = joinChatPath(chatDirectoryPath, fileName)

  const createResult = await createLibraryEntry(chatDirectoryPath, fileName, 'note', {
    androidDirectoryUri: library.androidTreeUri,
  })
  if (!createResult.ok) {
    throw new Error(createResult.error ?? 'No se pudo crear el archivo del chat.')
  }

  await saveChatDocument(filePath, {
    title: `Chat temporal ${readableStamp}`,
    longTermMemoryEnabled: config.longTermMemoryEnabled,
    contextMemoryEnabled: config.contextMemoryEnabled,
    contextMemoryMessageCount: config.contextMemoryMessageCount,
    contextScopeKey: null,
    selectedContextMode: 'direct',
    selectedContextFiles: [],
    messages: [],
  })

  return { filePath }
}

export async function deleteChatDraftFile(filePath: string): Promise<void> {
  const result = await performLibraryEntryOperation({
    action: 'delete',
    targetPath: filePath,
  })

  if (!result.ok) {
    throw new Error(result.error ?? 'No se pudo eliminar el archivo del chat.')
  }
}
