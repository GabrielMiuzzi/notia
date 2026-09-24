import { lift, setBlockType, toggleMark, wrapIn } from '@milkdown/kit/prose/commands'
import type { MarkType, Node as ProseMirrorNode, ResolvedPos } from '@milkdown/kit/prose/model'
import { liftListItem, wrapInList } from '@milkdown/kit/prose/schema-list'
import { NodeSelection, TextSelection, type Command, type EditorState } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { isRichTextColor, type BlockAlignment, type RichTextColor } from '../../../../engines/markdown/richTextMarkdown'
import { HIGHLIGHT_MARK, TEXT_COLOR_MARK, UNDERLINE_MARK } from './richTextMarks'

export type BlockKind = 'paragraph' | 'heading1' | 'heading2' | 'heading3' | 'bullet' | 'ordered' | 'quote'

export const BLOCK_KINDS: ReadonlyArray<{ kind: BlockKind; label: string }> = [
  { kind: 'paragraph', label: 'Párrafo' },
  { kind: 'heading1', label: 'Título 1' },
  { kind: 'heading2', label: 'Título 2' },
  { kind: 'heading3', label: 'Título 3' },
  { kind: 'bullet', label: 'Lista' },
  { kind: 'ordered', label: 'Lista numerada' },
  { kind: 'quote', label: 'Cita' },
]

export const TOGGLE_MARKS = ['strong', 'emphasis', UNDERLINE_MARK, 'strike_through', 'inlineCode'] as const
export type ToggleMarkName = typeof TOGGLE_MARKS[number]
export type ColorMarkName = typeof TEXT_COLOR_MARK | typeof HIGHLIGHT_MARK

/** Marks that «Quitar formato» removes; links stay. */
const CLEARABLE_MARKS = [...TOGGLE_MARKS, TEXT_COLOR_MARK, HIGHLIGHT_MARK]
const LIST_NODES = new Set(['bullet_list', 'ordered_list', 'list_item'])
/** Nudges the lift loop out of nested lists and quotes without looping forever. */
const MAX_LIFT_STEPS = 8

export interface FormatState {
  /** `null` when the selection spans blocks of different kinds. */
  blockKind: BlockKind | null
  canChangeBlock: boolean
  marks: Record<ToggleMarkName | 'link', boolean>
  textColor: RichTextColor | null
  highlight: RichTextColor | null
  align: BlockAlignment
  /** Alignment is written for top-level paragraphs and headings only. */
  canAlign: boolean
}

interface TextblockAt {
  node: ProseMirrorNode
  pos: number
}

/** Document range the toolbar formats: the selection or a whole block. */
export interface FormatRange {
  from: number
  to: number
}

/** Blocks the toolbar offers to format when the pointer is over them. */
const HOVER_FORMATTABLE_NODES = new Set(['paragraph', 'heading', 'list_item', 'blockquote'])

function selectionRange(state: EditorState): FormatRange {
  return { from: state.selection.from, to: state.selection.to }
}

function selectedTextblocks(state: EditorState, range = selectionRange(state)): TextblockAt[] {
  const blocks: TextblockAt[] = []
  const { from, to } = range
  state.doc.nodesBetween(from, Math.max(to, from + 1), (node, pos) => {
    if (!node.isTextblock) return true
    blocks.push({ node, pos })
    return false
  })
  return blocks
}

function hasAncestor($pos: ResolvedPos, names: Set<string> | string): boolean {
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    const name = $pos.node(depth).type.name
    if (typeof names === 'string' ? name === names : names.has(name)) return true
  }
  return false
}

function blockKindAt(state: EditorState, block: TextblockAt): BlockKind | null {
  if (block.node.type.name === 'heading') {
    const level = Number(block.node.attrs.level)
    return level === 1 ? 'heading1' : level === 2 ? 'heading2' : level === 3 ? 'heading3' : null
  }
  if (block.node.type.name !== 'paragraph') return null
  const $pos = state.doc.resolve(block.pos + 1)
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    const name = $pos.node(depth).type.name
    if (name === 'bullet_list') return 'bullet'
    if (name === 'ordered_list') return 'ordered'
    if (name === 'blockquote') return 'quote'
  }
  return 'paragraph'
}

function isMarkActive(state: EditorState, type: MarkType | undefined, { from, to }: FormatRange): boolean {
  if (!type) return false
  if (from === to) return Boolean(type.isInSet(state.storedMarks ?? state.selection.$from.marks()))
  return state.doc.rangeHasMark(from, to, type)
}

function colorOf(state: EditorState, type: MarkType | undefined, { from, to }: FormatRange): RichTextColor | null {
  if (!type) return null
  const readColor = (marks: readonly { type: MarkType; attrs: Record<string, unknown> }[]) => {
    const color = marks.find((mark) => mark.type === type)?.attrs.color
    return isRichTextColor(color) ? color : null
  }
  if (from === to) return readColor(state.storedMarks ?? state.selection.$from.marks())
  let color: RichTextColor | null = null
  state.doc.nodesBetween(from, to, (node) => {
    if (color === null && node.isText) color = readColor(node.marks)
    return color === null
  })
  return color
}

/** Formatting of the selection, or of `range` when the toolbar belongs to a whole block. */
export function readFormatState(state: EditorState, range = selectionRange(state)): FormatState {
  const blocks = selectedTextblocks(state, range)
  const kinds = new Set(blocks.map((block) => blockKindAt(state, block)))
  const first = blocks[0]
  const insideTable = hasAncestor(state.doc.resolve(range.from), 'table')
  const marks = Object.fromEntries(
    [...TOGGLE_MARKS, 'link'].map((name) => [name, isMarkActive(state, state.schema.marks[name], range)]),
  ) as FormatState['marks']
  const align = first?.node.attrs.align
  return {
    blockKind: kinds.size === 1 ? [...kinds][0] ?? null : null,
    canChangeBlock: blocks.length > 0 && !insideTable && [...kinds].every((kind) => kind !== null),
    marks,
    textColor: colorOf(state, state.schema.marks[TEXT_COLOR_MARK], range),
    highlight: colorOf(state, state.schema.marks[HIGHLIGHT_MARK], range),
    align: align === 'center' || align === 'right' ? align : 'left',
    canAlign: blocks.length > 0 && blocks.every((block) => (
      ['paragraph', 'heading'].includes(block.node.type.name) && state.doc.resolve(block.pos).depth === 0
    )),
  }
}

/** Whether the selection is text (or a text block picked with the handle) that the toolbar can format. */
export function isFormattableSelection(state: EditorState): boolean {
  const { selection } = state
  if (selection.empty) return false
  if (selection instanceof NodeSelection) {
    return selection.node.isTextblock || selection.node.type.name === 'blockquote' || LIST_NODES.has(selection.node.type.name)
  }
  if (!(selection instanceof TextSelection)) return false
  return !selection.$from.parent.type.spec.code && !selection.$to.parent.type.spec.code
}

/**
 * Range of the text block at `pos` when the toolbar can format it as a
 * whole: paragraphs, headings, list items and quotes with text, outside tables.
 */
export function formattableBlockRange(state: EditorState, pos: number): FormatRange | null {
  const node = state.doc.nodeAt(pos)
  if (!node || !HOVER_FORMATTABLE_NODES.has(node.type.name) || node.textContent.trim() === '') return null
  if (hasAncestor(state.doc.resolve(pos), 'table')) return null
  return { from: pos, to: pos + node.nodeSize }
}

/** Selects the text of the block at `pos`, so the toolbar's commands format all of it. */
export function selectBlockText(view: EditorView, pos: number): void {
  const range = formattableBlockRange(view.state, pos)
  if (!range) return
  const { doc } = view.state
  view.dispatch(view.state.tr.setSelection(TextSelection.between(doc.resolve(range.from), doc.resolve(range.to))))
}

function run(view: EditorView, command: Command): boolean {
  return command(view.state, view.dispatch)
}

export function toggleFormatMark(view: EditorView, name: ToggleMarkName): void {
  const type = view.state.schema.marks[name]
  if (type) run(view, toggleMark(type))
}

/** Replaces the text color or highlight of the selection; `null` removes it. */
export function setColorMark(view: EditorView, name: ColorMarkName, color: RichTextColor | null): void {
  const type = view.state.schema.marks[name]
  if (!type) return
  const { selection } = view.state
  let tr = view.state.tr
  if (selection.empty) {
    tr = color ? tr.addStoredMark(type.create({ color })) : tr.removeStoredMark(type)
  } else {
    selection.ranges.forEach(({ $from, $to }) => {
      tr = tr.removeMark($from.pos, $to.pos, type)
      if (color) tr = tr.addMark($from.pos, $to.pos, type.create({ color }))
    })
  }
  view.dispatch(tr)
}

export function setBlockAlignment(view: EditorView, align: BlockAlignment): void {
  const { state } = view
  if (!readFormatState(state).canAlign) return
  let tr = state.tr
  selectedTextblocks(state).forEach((block) => {
    tr = tr.setNodeAttribute(block.pos, 'align', align === 'left' ? null : align)
  })
  view.dispatch(tr)
}

/** Removes character formatting and alignment; links are kept. */
export function clearFormatting(view: EditorView): void {
  const { state } = view
  const types = CLEARABLE_MARKS
    .map((name) => state.schema.marks[name])
    .filter((type): type is MarkType => Boolean(type))
  let tr = state.tr
  if (state.selection.empty) {
    types.forEach((type) => { tr = tr.removeStoredMark(type) })
  } else {
    state.selection.ranges.forEach(({ $from, $to }) => {
      types.forEach((type) => { tr = tr.removeMark($from.pos, $to.pos, type) })
    })
  }
  if (readFormatState(state).canAlign) {
    selectedTextblocks(state).forEach((block) => { tr = tr.setNodeAttribute(block.pos, 'align', null) })
  }
  view.dispatch(tr)
}

/** Turns the selected blocks into `kind`, leaving lists and quotes first when needed. */
export function setBlockKind(view: EditorView, kind: BlockKind): void {
  const { schema } = view.state
  const format = readFormatState(view.state)
  if (!format.canChangeBlock || format.blockKind === kind) return
  if (view.state.selection instanceof NodeSelection) {
    const { from, to } = view.state.selection
    view.dispatch(view.state.tr.setSelection(TextSelection.between(view.state.doc.resolve(from), view.state.doc.resolve(to))))
  }
  const listItem = schema.nodes.list_item
  for (let step = 0; step < MAX_LIFT_STEPS; step += 1) {
    const { $from } = view.state.selection
    const lifted = hasAncestor($from, 'list_item') && listItem
      ? run(view, liftListItem(listItem))
      : hasAncestor($from, 'blockquote') && run(view, lift)
    if (!lifted) break
  }
  const paragraph = schema.nodes.paragraph
  const heading = schema.nodes.heading
  if (!paragraph || !heading) return
  if (kind.startsWith('heading')) {
    run(view, setBlockType(heading, { level: Number(kind.slice('heading'.length)) }))
    return
  }
  run(view, setBlockType(paragraph))
  const wrapper = kind === 'bullet' ? schema.nodes.bullet_list : kind === 'ordered' ? schema.nodes.ordered_list : kind === 'quote' ? schema.nodes.blockquote : null
  if (!wrapper) return
  run(view, kind === 'quote' ? wrapIn(wrapper) : wrapInList(wrapper))
}
