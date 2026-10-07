import { callBackend } from '../../../services/transport'
import type { MermaidEdit, MermaidEditResult, MermaidModel } from './mermaidEditorTypes'

/**
 * Client of the Mermaid editor commands: the backend reads the diagram and
 * applies the person's edits; the editor only shows them.
 */

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message
  if (error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string') {
    return (error as { message: string }).message
  }
  return fallback
}

export async function readMermaidModel(source: string): Promise<MermaidModel> {
  try {
    return await callBackend<MermaidModel>('mermaid_document', { payload: { source } })
  } catch (error) {
    throw new Error(errorMessage(error, 'No se pudo leer el diagrama.'))
  }
}

export async function applyMermaidEdit(source: string, edit: MermaidEdit): Promise<MermaidEditResult> {
  try {
    return await callBackend<MermaidEditResult>('mermaid_edit', { payload: { source, edit } })
  } catch (error) {
    throw new Error(errorMessage(error, 'No se pudo cambiar el diagrama.'))
  }
}
