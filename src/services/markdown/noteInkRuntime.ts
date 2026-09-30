import { callBackend } from '../transport'
import type { PenColor } from '../preferences/editorPreferences'

/*
 * Handwriting over a note. Rust keeps the strokes in `.notia/ink/<note>.json`
 * of the library, validates, smooths and simplifies each new one, and finds
 * what the eraser touches. A stroke belongs to a page (page mode) or to the
 * continuous sheet; each mode loads only its own.
 */

export type InkTool = 'pen' | 'highlighter'

/** `[x, y, pressure]` in CSS pixels of the unscaled sheet (of the page, in page mode). */
export type InkPoint = [number, number, number]

export interface InkStroke {
  id: string
  tool: InkTool
  color: PenColor
  width: number
  /** Index of the page in page mode; absent on the continuous sheet. */
  page?: number | null
  points: InkPoint[]
}

export interface InkStrokeDraft extends InkStroke {
  /** The pen's «Suavizado del trazo», 0 to 100; Rust applies it. */
  smoothing: number
}

interface InkStrokesResult {
  strokes: InkStroke[]
}

export async function loadInk(libraryId: string, path: string, paged: boolean): Promise<InkStroke[]> {
  const result = await callBackend<InkStrokesResult>('markdown_ink_load', { payload: { libraryId, path, paged } })
  return result.strokes
}

/** Saves a stroke; resolves with it as kept (smoothed and simplified). */
export function addInkStroke(libraryId: string, path: string, stroke: InkStrokeDraft): Promise<InkStroke> {
  return callBackend<InkStroke>('markdown_ink_add', { payload: { libraryId, path, stroke } })
}

export async function removeInkStrokes(libraryId: string, path: string, ids: string[]): Promise<InkStroke[]> {
  const result = await callBackend<InkStrokesResult>('markdown_ink_remove', { payload: { libraryId, path, ids } })
  return result.strokes
}

export async function restoreInkStrokes(libraryId: string, path: string, strokes: InkStroke[]): Promise<void> {
  await callBackend<InkStrokesResult>('markdown_ink_restore', { payload: { libraryId, path, strokes } })
}

/** Erases what the eraser's path touches on a surface; resolves with what it took. */
export async function eraseInk(
  libraryId: string,
  path: string,
  page: number | null,
  points: Array<[number, number]>,
  radius: number,
): Promise<InkStroke[]> {
  const result = await callBackend<InkStrokesResult>('markdown_ink_erase', { payload: { libraryId, path, page, points, radius } })
  return result.strokes
}
