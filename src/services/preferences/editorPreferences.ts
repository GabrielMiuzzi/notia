/**
 * Editor preferences of this device, stored and normalized by the backend
 * with the other device preferences (`backend_core::page_setup` and
 * `backend_core::device_preferences`).
 */

/** Page mode only offers A3. */
export type PaperFormatId = 'a3'
export type PageOrientation = 'portrait' | 'landscape'
export type PageMarginsId = 'narrow' | 'normal' | 'wide'

/**
 * The page a note in page mode is drawn on; the PDF exports use it too.
 * Whether a note is in page mode is the note's own `pageMode` property
 * (`services/markdown/notePageModeRuntime`).
 */
export interface EditorPagePreferences {
  format: PaperFormatId
  orientation: PageOrientation
  margins: PageMarginsId
  pageNumbers: boolean
}

export type PenColor = 'ink' | 'teal' | 'blue' | 'red' | 'orange' | 'yellow'
export type PenSideButton = 'eraser' | 'select' | 'none'

/**
 * Handwriting settings of the pen bar: ink color, tip size (1 to 16 px),
 * smoothing and the hardware options. The tool is chosen in the bar.
 */
export interface PenPreferences {
  color: PenColor
  thickness: number
  smoothing: number
  pressure: boolean
  palmRejection: boolean
  penOnly: boolean
  sideButton: PenSideButton
}

/** What the backend derives from the page setup to draw it; never saved. */
export interface EditorPageSetup {
  formats: Array<{ id: PaperFormatId; label: string; widthMm: number; heightMm: number }>
  margins: Array<{ id: PageMarginsId; label: string; marginMm: number }>
  widthMm: number
  heightMm: number
  marginMm: number
  pageNumbers: boolean
  /** Width of the sheet of a note not in page mode: a portrait A3. */
  continuousWidthMm: number
}

/**
 * The sheet the editor draws: A3 pages in page mode, or one continuous
 * sheet as wide as an A3, with the same margins, when the note is not.
 */
export interface MarkdownPageLayout {
  paged: boolean
  widthMm: number
  heightMm: number
  marginMm: number
  pageNumbers: boolean
}
