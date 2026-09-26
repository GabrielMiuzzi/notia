import { Plugin, PluginKey, type EditorState } from '@milkdown/kit/prose/state'
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
} from '../../../../engines/markdown/wikiLinkEngine'

const WIKI_LINK_PLUGIN_KEY = new PluginKey('notia-wikilink-plugin')
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

function buildWikiLinkDecorations(state: EditorState, lookup: MarkdownWikiLinkLookup): DecorationSet {
  const decorations: Decoration[] = []

  state.doc.descendants((node, position, parent) => {
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
      const matchFrom = position + match.startOffset
      const matchTo = position + match.endOffset
      const target = resolveWikiLinkTarget(lookup, match.reference)
      const className = target
        ? `notia-wikilink-token ${RESOLVED_WIKI_LINK_CLASS}`
        : 'notia-wikilink-token notia-wikilink-token--broken'

      decorations.push(
        Decoration.inline(matchFrom, matchTo, {
          class: className,
        }),
      )
    }

    return
  })

  return DecorationSet.create(state.doc, decorations)
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
        props: {
          decorations: (state) => buildWikiLinkDecorations(state, config.getLookup()),
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
