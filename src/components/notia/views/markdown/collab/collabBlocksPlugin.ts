import { Plugin, PluginKey } from '@milkdown/prose/state'
import { Decoration, DecorationSet } from '@milkdown/prose/view'
import type { EditorState } from '@milkdown/prose/state'
import { relativePositionToAbsolutePosition, ySyncPluginKey } from 'y-prosemirror'
import { createRelativePositionFromJSON } from 'yjs'
import type { Awareness } from 'y-protocols/awareness'

export const collabBlocksKey = new PluginKey('NOTIA_COLLAB_BLOCKS')

interface AwarenessUser {
  name?: unknown
  color?: unknown
}

interface AwarenessCursor {
  head?: unknown
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/

/**
 * Marks the block each other person is writing in a shared note: its
 * border takes their color and shows their name. The cursors come from
 * the room's awareness (`markdownCollab`).
 */
export function createCollabBlocksPlugin(getAwareness: () => Awareness | null): Plugin {
  return new Plugin({
    key: collabBlocksKey,
    props: {
      decorations: (state) => blockDecorations(state, getAwareness()),
    },
  })
}

function blockDecorations(state: EditorState, awareness: Awareness | null): DecorationSet | null {
  if (!awareness) return null
  const sync = ySyncPluginKey.getState(state) as {
    doc?: import('yjs').Doc
    type?: import('yjs').XmlFragment
    binding?: { mapping: Map<unknown, unknown> } | null
  } | undefined
  if (!sync?.doc || !sync.type || !sync.binding || sync.binding.mapping.size === 0) return null
  const decorations: Decoration[] = []
  const marked = new Set<number>()
  awareness.getStates().forEach((value, clientId) => {
    if (clientId === awareness.clientID) return
    const user = value.user as AwarenessUser | undefined
    const cursor = value.cursor as AwarenessCursor | undefined
    if (!user || !cursor?.head || typeof user.name !== 'string' || typeof user.color !== 'string' || !HEX_COLOR.test(user.color)) return
    const head = relativePositionToAbsolutePosition(
      sync.doc!,
      sync.type!,
      createRelativePositionFromJSON(cursor.head),
      sync.binding!.mapping as never,
    )
    if (head === null) return
    const position = Math.min(Math.max(head, 0), state.doc.content.size)
    const resolved = state.doc.resolve(position)
    const from = resolved.depth >= 1 ? resolved.before(1) : position
    const node = state.doc.nodeAt(from)
    if (!node || marked.has(from)) return
    marked.add(from)
    decorations.push(Decoration.node(from, from + node.nodeSize, {
      class: 'notia-collab-block',
      style: `--notia-collab-color: ${user.color}`,
      'data-collab-name': user.name,
    }))
  })
  return DecorationSet.create(state.doc, decorations)
}
