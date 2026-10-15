import type { Editor } from '@milkdown/kit/core'
import { replaceAll } from '@milkdown/kit/utils'

/** How the editor holds its note: alone, or in a shared room as the window that saves or one that follows. */
export type EditorSharing = 'alone' | 'saver' | 'follower'

/**
 * Puts in the editor a body that changed outside it (an edit of the agent).
 * Alone, the editor state is replaced and its undo history starts over. In
 * a shared room (Yjs) a new state rebinds the room, which paints its old
 * text back: the window that saves applies it as an edit, which reaches the
 * room, and the others get it from there (if every window replaced the
 * text, the room would join the replacements and repeat it). Returns
 * whether this editor applied it.
 */
export function replaceEditorBody(editor: Editor, body: string, sharing: EditorSharing): boolean {
  if (sharing === 'follower') return false
  editor.action(replaceAll(body, sharing === 'alone'))
  return true
}
