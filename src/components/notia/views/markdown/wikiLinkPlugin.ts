import { Plugin, PluginKey, TextSelection, type EditorState, type Selection, type StateField } from '@milkdown/kit/prose/state'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'
import { remarkStringifyOptionsCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import {
  findActiveWikiLinkContext,
  findWikiLinkMatches,
  resolveWikiLinkTarget,
  restoreEscapedWikiLinks,
  type MarkdownWikiLinkLookup,
  type WikiLinkTextMatch,
} from '../../../../engines/markdown/wikiLinkEngine'

const WIKI_LINK_PLUGIN_KEY = new PluginKey<WikiLinkDecorationState>('notia-wikilink-plugin')
/** Meta of a transaction that resolves every link again (the notes of the library changed). */
const WIKI_LINK_REFRESH_META = 'notia-refresh-wikilinks'
/** Brackets, `|` and `.md` of a link: dimmed while it is edited, hidden otherwise. */
const WIKI_LINK_SYNTAX_CLASS = 'notia-wikilink-syntax'
/** Class of a link that points to an existing note; only a click on it opens the note. */
const RESOLVED_WIKI_LINK_CLASS = 'notia-wikilink-token--resolved'

export interface WikiLinkMenuContext {
  query: string
  replaceFrom: number
  replaceTo: number
  anchorLeft: number
  anchorTop: number
}

interface CreateWikiLinkPluginConfig {
  getLookup: () => MarkdownWikiLinkLookup
  isMenuOpen: () => boolean
  onMenuContextChange: (context: WikiLinkMenuContext | null) => void
  onMoveMenuSelection: (direction: -1 | 1) => void
  onCloseMenu: () => void
  onConfirmMenuSelection: (view: EditorView) => boolean
  onOpenLinkPath: (path: string) => void
}

function buildMenuContext(view: EditorView): WikiLinkMenuContext | null {
  const { selection } = view.state
  if (!selection.empty) {
    return null
  }

  const { $from } = selection
  const parentNode = $from.parent
  if (!parentNode.isTextblock) {
    return null
  }

  const context = findActiveWikiLinkContext(parentNode.textContent, $from.parentOffset)
  if (!context) {
    return null
  }

  const rawCandidate = parentNode.textContent.slice(context.startOffset, context.endOffset)
  if (rawCandidate.endsWith(']]')) {
    return null
  }

  const replaceFrom = $from.start() + context.startOffset
  const replaceTo = $from.start() + context.endOffset

  const cursorCoordinates = view.coordsAtPos(selection.from)
  return {
    query: context.query,
    replaceFrom,
    replaceTo,
    anchorLeft: cursorCoordinates.left,
    anchorTop: cursorCoordinates.bottom,
  }
}

/** A wikilink in the document: the whole `[[…]]` and the text it shows. */
export interface WikiLinkRange {
  from: number
  to: number
  labelFrom: number
  labelTo: number
  match: WikiLinkTextMatch
}

function toRange(textPosition: number, match: WikiLinkTextMatch): WikiLinkRange {
  return {
    from: textPosition + match.startOffset,
    to: textPosition + match.endOffset,
    labelFrom: textPosition + match.labelStartOffset,
    labelTo: textPosition + match.labelEndOffset,
    match,
  }
}

/** Code keeps its brackets: a wikilink inside code is plain text. */
function isCodeText(node: ProseNode, parent: ProseNode | null): boolean {
  return parent?.type.name === 'code_block' || node.marks.some((mark) => mark.type.name === 'code')
}

/** The wikilink whose `[[…]]` contains `position` (its edges included), if any. */
export function findWikiLinkAt(state: EditorState, position: number): WikiLinkRange | null {
  const $position = state.doc.resolve(position)
  const block = $position.parent
  if (!block.isTextblock || block.type.name === 'code_block') return null
  const start = $position.start()
  let found: WikiLinkRange | null = null
  block.forEach((node, offset) => {
    if (found || !node.isText || !node.text || isCodeText(node, block)) return
    const link = findWikiLinkMatches(node.text)
      .map((match) => toRange(start + offset, match))
      .find((range) => position >= range.from && position <= range.to)
    if (link) found = link
  })
  return found
}

/**
 * Whether the person is working on the link: the cursor or the selection
 * touches it. Then its brackets show, so deleting from its end leaves
 * `[[nota]` and the link goes away; otherwise only the text it shows is seen.
 */
export function isEditingWikiLink(selection: Pick<Selection, 'from' | 'to'>, link: Pick<WikiLinkRange, 'from' | 'to'>): boolean {
  return selection.from <= link.to && selection.to >= link.from
}

/** Adds the decorations of the links inside `node`, whose content starts at `contentStart`. */
function collectWikiLinkDecorations(
  node: ProseNode,
  contentStart: number,
  selection: Pick<Selection, 'from' | 'to'>,
  lookup: MarkdownWikiLinkLookup,
  decorations: Decoration[],
): void {
  node.descendants((child, offset, parent) => {
    if (child.type.name === 'code_block') {
      return false
    }

    if (!child.isText || !child.text || isCodeText(child, parent)) {
      return
    }

    for (const match of findWikiLinkMatches(child.text)) {
      const link = toRange(contentStart + offset, match)
      const target = resolveWikiLinkTarget(lookup, match.reference)
      const className = target
        ? `notia-wikilink-token ${RESOLVED_WIKI_LINK_CLASS}`
        : 'notia-wikilink-token notia-wikilink-token--broken'

      // The note's path lets the editor show its card on hover.
      decorations.push(Decoration.inline(link.from, link.to, target ? { class: className, 'data-wikilink-path': target.path } : { class: className }))
      if (link.labelTo <= link.labelFrom) continue
      const syntaxClass = isEditingWikiLink(selection, link) ? WIKI_LINK_SYNTAX_CLASS : `${WIKI_LINK_SYNTAX_CLASS} is-hidden`
      decorations.push(Decoration.inline(link.from, link.labelFrom, { class: syntaxClass }))
      if (link.labelTo < link.to) decorations.push(Decoration.inline(link.labelTo, link.to, { class: syntaxClass }))
    }

    return
  })
}

/** The decorations of every link of the note. */
export function buildWikiLinkDecorations(state: EditorState, lookup: MarkdownWikiLinkLookup): DecorationSet {
  const decorations: Decoration[] = []
  collectWikiLinkDecorations(state.doc, 0, state.selection, lookup, decorations)
  return DecorationSet.create(state.doc, decorations)
}

interface PositionRange {
  from: number
  to: number
}

/** The stretch of `next` that differs from `previous`, or `null` when nothing does. */
function changedRange(previous: ProseNode, next: ProseNode): PositionRange | null {
  const start = previous.content.findDiffStart(next.content)
  if (start === null) return null
  const end = previous.content.findDiffEnd(next.content)
  if (!end) return { from: start, to: start }
  // Repeated content can make both ends cross; move them past the start.
  const overlap = start - Math.min(end.a, end.b)
  return { from: start, to: overlap > 0 ? end.b + overlap : end.b }
}

/**
 * Decorates again the text blocks that touch `ranges` (their edges
 * included), with the rest of the set as it was. A link never leaves its
 * text block, so the others keep their decorations.
 */
function redecorateTextblocks(
  decorations: DecorationSet,
  state: EditorState,
  ranges: PositionRange[],
  lookup: MarkdownWikiLinkLookup,
): DecorationSet {
  const { doc, selection } = state
  const done = new Set<number>()
  let next = decorations
  for (const range of ranges) {
    const from = Math.max(0, Math.min(range.from, range.to) - 1)
    const to = Math.min(doc.content.size, Math.max(range.from, range.to) + 1)
    doc.nodesBetween(from, to, (node, position) => {
      if (!node.isTextblock) return true
      if (done.has(position)) return false
      done.add(position)
      next = next.remove(next.find(position, position + node.nodeSize))
      if (node.type.name === 'code_block') return false
      const fresh: Decoration[] = []
      collectWikiLinkDecorations(node, position + 1, selection, lookup, fresh)
      if (fresh.length > 0) next = next.add(doc, fresh)
      return false
    })
  }
  return next
}

export interface WikiLinkDecorationState {
  decorations: DecorationSet
  /** The notes the links were resolved against. */
  lookup: MarkdownWikiLinkLookup
}

/**
 * The links' decorations, kept from one state to the next: an edit decorates
 * again only the text blocks it changed, and a moved cursor only those it
 * left or reached (their brackets show or hide). Every link is resolved
 * again when the notes change (`notia-refresh-wikilinks`).
 */
export function wikiLinkDecorationField(getLookup: () => MarkdownWikiLinkLookup): StateField<WikiLinkDecorationState> {
  return {
    init: (_config, state) => {
      const lookup = getLookup()
      return { decorations: buildWikiLinkDecorations(state, lookup), lookup }
    },
    apply: (transaction, value, previous, next) => {
      const lookup = getLookup()
      if (lookup !== value.lookup || transaction.getMeta(WIKI_LINK_REFRESH_META) !== undefined) {
        return { decorations: buildWikiLinkDecorations(next, lookup), lookup }
      }

      if (!transaction.docChanged && previous.selection.eq(next.selection)) {
        return value
      }

      let decorations = value.decorations
      const ranges: PositionRange[] = []
      if (transaction.docChanged) {
        decorations = decorations.map(transaction.mapping, transaction.doc)
        const changed = changedRange(previous.doc, next.doc)
        if (changed) ranges.push(changed)
      }
      // Links whose brackets show or hide: those the old or the new selection touches.
      ranges.push(
        { from: transaction.mapping.map(previous.selection.from), to: transaction.mapping.map(previous.selection.to) },
        { from: next.selection.from, to: next.selection.to },
      )
      return { decorations: redecorateTextblocks(decorations, next, ranges, lookup), lookup }
    },
  }
}

/**
 * Where the cursor goes when it lands on a hidden part of a link from
 * outside, or `null` to leave it. Clicking right of `nota` puts the browser
 * caret at the end of the visible text, which is inside `]]`; the cursor
 * moves past `]]` (or before `[[` on the left) so typing continues outside
 * the link and Backspace deletes its last bracket.
 */
export function snapIntoWikiLinkEdge(previous: EditorState, next: EditorState): number | null {
  const { selection } = next
  if (!selection.empty) return null
  const link = findWikiLinkAt(next, selection.from)
  if (!link || isEditingWikiLink(previous.selection, link)) return null
  if (selection.from >= link.labelTo && selection.from < link.to) return link.to
  if (selection.from > link.from && selection.from <= link.labelFrom) return link.from
  return null
}

function resolveWikiLinkPathAtPosition(
  state: EditorState,
  position: number,
  lookup: MarkdownWikiLinkLookup,
): string | null {
  let insidePath: string | null = null
  // Position right after `]]`: the link on its left, unless another one starts there.
  let endingPath: string | null = null

  state.doc.descendants((node, nodePosition, parent) => {
    if (insidePath) {
      return false
    }

    if (node.type.name === 'code_block') {
      return false
    }

    if (!node.isText || !node.text) {
      return
    }

    if (parent?.type.name === 'code_block' || node.marks.some((mark) => mark.type.name === 'code')) {
      return
    }

    const matches = findWikiLinkMatches(node.text)
    for (const match of matches) {
      const from = nodePosition + match.startOffset
      const to = nodePosition + match.endOffset
      if (position < from || position > to) {
        continue
      }

      const target = resolveWikiLinkTarget(lookup, match.reference)
      if (!target) {
        continue
      }

      if (position === to) {
        endingPath ??= target.path
        continue
      }

      insidePath = target.path
      return false
    }

    return
  })

  return insidePath ?? endingPath
}

/**
 * Note a click opens, or `null`. ProseMirror maps a click anywhere past the
 * end of a line to the position right after its last character, so a line
 * ending in `[[nota]]` opened the note wherever it was clicked and could not
 * be edited. The click has to land on the link itself.
 */
export function resolveClickedWikiLinkPath(
  state: EditorState,
  position: number,
  target: EventTarget | null,
  lookup: MarkdownWikiLinkLookup,
): string | null {
  if (!(target instanceof Element) || !target.closest(`.${RESOLVED_WIKI_LINK_CLASS}`)) {
    return null
  }

  return resolveWikiLinkPathAtPosition(state, position, lookup)
}

/**
 * Keeps the brackets of `[[nota]]` unescaped when the note is saved. The
 * writer escapes every `[` so it cannot start a Markdown link, which turned
 * wikilinks into `\[\[nota]]`. Milkdown passes its own text writer through
 * the stringify options, which win over extensions, so this wraps that one.
 */
export function configureWikiLinkSerializer(ctx: Ctx): void {
  ctx.update(remarkStringifyOptionsCtx, (options) => {
    const writeText = options.handlers?.text
    if (!writeText) {
      return options
    }

    const text: typeof writeText = (node, parent, state, info) => restoreEscapedWikiLinks(writeText(node, parent, state, info))
    return { ...options, handlers: { ...options.handlers, text } }
  })
}

export function createWikiLinkPlugin(config: CreateWikiLinkPluginConfig) {
  return $prose(
    () =>
      new Plugin({
        key: WIKI_LINK_PLUGIN_KEY,
        state: wikiLinkDecorationField(config.getLookup),
        view: (view) => {
          config.onMenuContextChange(buildMenuContext(view))

          return {
            update: (nextView) => {
              config.onMenuContextChange(buildMenuContext(nextView))
            },
            destroy: () => {
              config.onMenuContextChange(null)
            },
          }
        },
        appendTransaction: (transactions, previous, next) => {
          // Only a cursor that moved on its own: typing is never redirected.
          if (transactions.some((transaction) => transaction.docChanged)) return null
          if (!transactions.some((transaction) => transaction.selectionSet)) return null
          const position = snapIntoWikiLinkEdge(previous, next)
          return position === null ? null : next.tr.setSelection(TextSelection.create(next.doc, position))
        },
        props: {
          decorations: (state) => WIKI_LINK_PLUGIN_KEY.getState(state)?.decorations,
          handleKeyDown: (view, event) => {
            if (!config.isMenuOpen()) {
              return false
            }

            if (event.key === 'ArrowDown') {
              event.preventDefault()
              config.onMoveMenuSelection(1)
              return true
            }

            if (event.key === 'ArrowUp') {
              event.preventDefault()
              config.onMoveMenuSelection(-1)
              return true
            }

            if (event.key === 'Escape') {
              event.preventDefault()
              config.onCloseMenu()
              return true
            }

            if (event.key === 'Enter' || event.key === 'Tab') {
              const hasConfirmed = config.onConfirmMenuSelection(view)
              if (hasConfirmed) {
                event.preventDefault()
                return true
              }
            }

            return false
          },
          handleClick: (view, position, event) => {
            const mouseEvent = event as MouseEvent
            if (mouseEvent.button !== 0) {
              return false
            }

            const resolvedPath = resolveClickedWikiLinkPath(view.state, position, mouseEvent.target, config.getLookup())
            if (!resolvedPath) {
              return false
            }

            mouseEvent.preventDefault()
            config.onOpenLinkPath(resolvedPath)
            return true
          },
        },
      }),
  )
}
