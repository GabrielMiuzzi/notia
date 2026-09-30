import { callBackend } from '../transport'
import type { PenColor } from '../preferences/editorPreferences'

/*
 * Handwriting over a note. Rust keeps the strokes in `.notia/ink/<note>.json`
 * of the library, validates, smooths and simplifies each new one, and finds
 * what the eraser touches. Strokes are kept in the note's flow (the text out
 * of page mode), so both modes show them; the editor moves them below the
 * page breaks in page mode (`views/markdown/ink/inkFlow`).
 */

export type InkTool = 'pen' | 'highlighter'

/** `[x, y, pressure]` in CSS pixels of the unscaled sheet, `y` in the note's flow. */
export type InkPoint = [number, number, number]

export interface InkStroke {
  id: string
  tool: InkTool
  color: PenColor
  width: number
  /**
   * Only strokes drawn on a page before strokes were kept in the flow: the
   * index of that page, with `y` on that page. The editor moves them into
   * the flow (`replaceInkStrokes`).
   */
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

export async function loadInk(libraryId: string, path: string): Promise<InkStroke[]> {
  const result = await callBackend<InkStrokesResult>('markdown_ink_load', { payload: { libraryId, path } })
  return result.strokes
}

/** New versions of strokes already kept (same ids): strokes drawn on a page, moved into the flow. */
export async function replaceInkStrokes(libraryId: string, path: string, strokes: InkStroke[]): Promise<void> {
  await callBackend<InkStrokesResult>('markdown_ink_replace', { payload: { libraryId, path, strokes } })
}

/** The strokes a lasso (closed path in the note's flow) takes: at least half of each inside. */
export async function selectInkInLasso(libraryId: string, path: string, lasso: Array<[number, number]>): Promise<string[]> {
  const result = await callBackend<{ ids: string[] }>('markdown_ink_select', { payload: { libraryId, path, lasso } })
  return result.ids
}

/** Moves strokes; resolves with them as they are now. */
export async function moveInkStrokes(libraryId: string, path: string, ids: string[], dx: number, dy: number): Promise<InkStroke[]> {
  const result = await callBackend<InkStrokesResult>('markdown_ink_move', { payload: { libraryId, path, ids, dx, dy } })
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
