/**
 * Editor preferences of this device, stored and normalized by the backend
 * with the other device preferences (`backend_core::page_setup` and
 * `backend_core::device_preferences`).
 */

export type PaperFormatId = 'a3' | 'a4' | 'a5' | 'b5' | 'letter' | 'legal'
export type PageOrientation = 'portrait' | 'landscape'
export type PageMarginsId = 'narrow' | 'normal' | 'wide'

/** Page mode and the page setup it uses; the PDF exports use it too. */
export interface EditorPagePreferences {
  pageMode: boolean
  format: PaperFormatId
  orientation: PageOrientation
  margins: PageMarginsId
  pageNumbers: boolean
}

export type PenTool = 'fountain' | 'pencil' | 'marker'
export type PenColor = 'ink' | 'teal' | 'blue' | 'red' | 'orange' | 'yellow'
export type PenSideButton = 'eraser' | 'select' | 'none'

/** Handwriting settings, kept for the pen that is not available yet. */
export interface PenPreferences {
  tool: PenTool
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
  /** Rust only exports a PDF with page mode on. */
  canExportPdf: boolean
}

/** The page the editor draws in page mode. */
export interface MarkdownPageLayout {
  widthMm: number
  heightMm: number
  marginMm: number
  pageNumbers: boolean
}
