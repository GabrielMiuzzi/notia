import { parseFrontmatterDocument } from '../../engines/markdown/frontmatterEngine'
import { join } from '../../utils/files/pathUtils'
import type { NotiaLibrary } from '../../types/notia'
import { readLibraryDirectory } from '../libraries/libraryRuntime'
import { readTextFile } from '../files/filesystemEngine'
import { ensureAgentPromptFile, loadAgentPrompt, listAgentPrompts } from '../ai/agentPromptRuntime'
import type { AgentPromptOption } from '../ai/agentPromptRuntime'
import type { MultichatAgent, MultichatDynamic } from '../../types/multichat'

const DYNAMICS_DIRECTORY = 'dynamics'
const AGENT_DIRECTORY = '.agent'
const PROMPTS_DIRECTORY = 'promps'
const MARKDOWN_FILE_PATTERN = /^[^\\/]+\.md$/i

export const MULTICHAT_PALETTE = ['#2563eb', '#7c3aed', '#db2777', '#ea580c', '#059669', '#0891b2'] as const
export const MULTICHAT_ICONS = ['●', '◆', '▲', '■', '★', '✦'] as const

export function isValidMultichatMarkdownFileName(fileName: string): boolean {
  return MARKDOWN_FILE_PATTERN.test(fileName.trim()) && fileName.trim() !== '.' && fileName.trim() !== '..'
}

export function stripMultichatFrontmatter(source: string): string {
  return parseFrontmatterDocument(source).body.trim()
}

export function resolveMultichatDynamicsPath(libraryPath: string): string {
  return join(join(libraryPath, AGENT_DIRECTORY), DYNAMICS_DIRECTORY)
}

function resolveMultichatPromptsPath(libraryPath: string): string {
  return join(join(libraryPath, AGENT_DIRECTORY), PROMPTS_DIRECTORY)
}

function filePath(directory: string, name: string): string {
  return join(directory, name)
}

export async function ensureMultichatDynamicsDirectory(library: NotiaLibrary): Promise<void> {
  // The existing agent initializer creates the parent and the dynamics folder
  // idempotently, while preserving every user-created Markdown file.
  await ensureAgentPromptFile(library)
}

export async function listMultichatDynamics(library: NotiaLibrary): Promise<MultichatDynamic[]> {
  await ensureMultichatDynamicsDirectory(library)
  const directory = resolveMultichatDynamicsPath(library.path)
  const entries = await readLibraryDirectory(directory, { androidDirectoryUri: library.androidTreeUri })
  const files = entries
    .filter((entry) => entry.type === 'file' && isValidMultichatMarkdownFileName(entry.name))
  return Promise.all(files.map(async (entry) => {
    const result = await readTextFile(filePath(directory, entry.name), { androidDirectoryUri: library.androidTreeUri })
    return {
      fileName: entry.name,
      name: entry.name.replace(/\.md$/i, ''),
      content: result.ok ? stripMultichatFrontmatter(result.content) : '',
    }
  }))
}

export async function loadMultichatDynamic(library: NotiaLibrary, fileName: string): Promise<MultichatDynamic> {
  if (!isValidMultichatMarkdownFileName(fileName)) throw new Error('La dinámica seleccionada no es válida.')
  await ensureMultichatDynamicsDirectory(library)
  const result = await readTextFile(filePath(resolveMultichatDynamicsPath(library.path), fileName), { androidDirectoryUri: library.androidTreeUri })
  if (!result.ok) throw new Error('No se pudo leer la dinámica seleccionada.')
  const content = stripMultichatFrontmatter(result.content)
  if (!content) throw new Error('La dinámica seleccionada está vacía.')
  return { fileName, name: fileName.replace(/\.md$/i, ''), content }
}

export async function listMultichatAgentPrompts(library: NotiaLibrary): Promise<AgentPromptOption[]> {
  return listAgentPrompts(library)
}

export async function loadMultichatAgent(library: NotiaLibrary, fileName: string, index: number): Promise<MultichatAgent> {
  if (!isValidMultichatMarkdownFileName(fileName)) throw new Error('El prompt seleccionado no es válido.')
  await ensureAgentPromptFile(library)
  const promptResult = fileName.toLocaleLowerCase() === 'default.md'
    ? { ok: true as const, content: await loadAgentPrompt(library, fileName) }
    : await readTextFile(filePath(resolveMultichatPromptsPath(library.path), fileName), { androidDirectoryUri: library.androidTreeUri })
  if (!promptResult.ok) throw new Error('No se pudo leer el prompt seleccionado.')
  const prompt = stripMultichatFrontmatter(promptResult.content)
  if (!prompt) throw new Error('El prompt seleccionado está vacío.')
  return {
    fileName,
    name: fileName.replace(/\.md$/i, ''),
    prompt,
    icon: MULTICHAT_ICONS[index % MULTICHAT_ICONS.length],
    color: MULTICHAT_PALETTE[index % MULTICHAT_PALETTE.length],
  }
}

export function validateMultichatLoadedSelection(dynamic: MultichatDynamic | null, agents: readonly MultichatAgent[]): string | null {
  if (!dynamic?.content.trim()) return 'Seleccioná una dinámica válida.'
  if (agents.length < 1 || agents.length > 6) return 'Seleccioná entre uno y seis agentes.'
  if (agents.some((agent) => !agent.prompt.trim())) return 'Todos los prompts seleccionados deben tener contenido.'
  return null
}
