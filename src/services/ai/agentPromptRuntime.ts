import { callBackend } from '../transport'
import type { NotiaLibrary } from '../../types/notia'

/*
 * The `.agent` workspace (folders, rules, memories, prompts and the selected
 * prompt) lives in the Rust backend (`agent_workspace.rs`), which also
 * composes the system prompt. This module is a client of its commands.
 */

const DEFAULT_PROMPT_FILE_NAME = 'default.md'
const LEGACY_SELECTION_STORAGE_KEY = 'notia:agent-prompt-selection:v1'

export interface AgentPromptOption {
  fileName: string
  name: string
}

export interface AgentPromptSelection {
  prompts: AgentPromptOption[]
  selected: string
}

function libraryPayload(library: Pick<NotiaLibrary, 'id'>): { payload: { libraryId: string } } {
  return { payload: { libraryId: library.id } }
}

/** Prompt files of the library and the one selected on this device. */
export async function loadAgentPromptSelection(library: Pick<NotiaLibrary, 'id'>): Promise<AgentPromptSelection> {
  await migrateLegacySelection(library.id)
  return callBackend<AgentPromptSelection>('backend_agent_prompts', libraryPayload(library))
}

export async function loadSelectedAgentPromptFileName(libraryId: string): Promise<string> {
  try {
    return (await loadAgentPromptSelection({ id: libraryId })).selected
  } catch {
    return DEFAULT_PROMPT_FILE_NAME
  }
}

export function saveSelectedAgentPromptFileName(libraryId: string, fileName: string): Promise<string> {
  return callBackend<string>('backend_select_agent_prompt', { payload: { libraryId, fileName } })
}

/** Moves the selection older versions kept in the WebView, once. */
async function migrateLegacySelection(libraryId: string): Promise<void> {
  let selections: Record<string, unknown>
  try {
    const parsed = JSON.parse(window.localStorage.getItem(LEGACY_SELECTION_STORAGE_KEY) ?? 'null') as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return
    selections = parsed as Record<string, unknown>
  } catch {
    return
  }
  const legacy = selections[libraryId]
  if (typeof legacy !== 'string') return
  await saveSelectedAgentPromptFileName(libraryId, legacy)
  const rest = { ...selections }
  delete rest[libraryId]
  try {
    if (Object.keys(rest).length === 0) window.localStorage.removeItem(LEGACY_SELECTION_STORAGE_KEY)
    else window.localStorage.setItem(LEGACY_SELECTION_STORAGE_KEY, JSON.stringify(rest))
  } catch {
    // The backend already holds the selection; a stale copy is ignored.
  }
}

export async function writeAgentMemories(library: NotiaLibrary, memories: string[]): Promise<void> {
  await callBackend<string[]>('backend_save_agent_memories', { payload: { libraryId: library.id, items: memories } })
}

