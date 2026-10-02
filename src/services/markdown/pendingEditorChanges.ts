/*
 * The note editor keeps the last keystrokes for a moment and writes the
 * Markdown once typing pauses (`views/markdown/markdownChangeBuffer`). Before
 * anything reads or saves the open notes (closing a tab, saving before
 * leaving the library or the app), the open editors hand over what they
 * still hold, so the latest text is never lost nor stale.
 */

const flushers = new Set<() => void>()

/** An open editor that can hand over its pending text; returns the cleanup. */
export function registerPendingEditorChanges(flush: () => void): () => void {
  flushers.add(flush)
  return () => {
    flushers.delete(flush)
  }
}

/** Every open editor hands its pending text to its tab, synchronously. */
export function flushPendingEditorChanges(): void {
  for (const flush of [...flushers]) {
    try {
      flush()
    } catch (error) {
      // One editor that cannot write its Markdown must not stop the others from saving.
      console.error('[notia] an editor could not hand over its pending changes', error)
    }
  }
}
