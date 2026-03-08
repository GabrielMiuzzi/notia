import { Plugin, PluginKey, type EditorState } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'
import {
  findActiveWikiLinkContext,
  findWikiLinkMatches,
  resolveWikiLinkTarget,
  type MarkdownWikiLinkLookup,
} from '../../../../engines/markdown/wikiLinkEngine'

const WIKI_LINK_PLUGIN_KEY = new PluginKey('notia-wikilink-plugin')

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
      const target = resolveWikiLinkTarget(lookup, match.reference)
      const className = target
        ? 'notia-wikilink-token notia-wikilink-token--resolved'
        : 'notia-wikilink-token notia-wikilink-token--broken'

      decorations.push(
        Decoration.inline(position + match.startOffset, position + match.endOffset, {
          class: className,
          'data-wikilink-ref': match.reference,
          'data-wikilink-label': match.displayLabel,
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
  let resolvedPath: string | null = null

  state.doc.descendants((node, nodePosition, parent) => {
    if (resolvedPath) {
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

      resolvedPath = target.path
      return false
    }

    return
  })

  return resolvedPath
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

            const resolvedPath = resolveWikiLinkPathAtPosition(view.state, position, config.getLookup())
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
