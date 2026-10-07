import type { DiagramSelection } from './mermaidEditorTypes'

/** What the panels of one diagram type can do on the editor. */
export interface EditorApi<Model> {
  model: Model
  selection: DiagramSelection | null
  select: (selection: DiagramSelection | null) => void
  /** Sends `{ op, ...fields }` for this diagram type; resolves whether it applied. */
  edit: (op: string, fields?: Record<string, unknown>) => Promise<boolean>
  /** Starts linking from `from` (a node, state, class, entity or participant). */
  startLink: (from: string, extra?: Record<string, unknown>) => void
  /** Shows a tab of the dock (`shapes`, `icons`, `elements`, `code`). */
  showTab: (tab: string) => void
}

export const selectionIs = (selection: DiagramSelection | null, kind: DiagramSelection['kind']) => (selection?.kind === kind ? selection.key : null)
