import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'

/*
 * Writing the Markdown of the whole note on every keystroke made typing lag
 * (Milkdown's listener serialized once per change). The editor writes it once
 * the editing pauses, and at once when it loses focus, closes or something
 * asks for it (`services/markdown/pendingEditorChanges`).
 */

/** A pause this long in the editing writes the note's Markdown. */
export const MARKDOWN_CHANGE_DEBOUNCE_MS = 250
/** Typing without pauses still writes it at least this often. */
export const MARKDOWN_CHANGE_MAX_WAIT_MS = 2000

export interface MarkdownChangeBufferOptions<Doc> {
  delayMs?: number
  maxWaitMs?: number
  /** Whether two documents are the same, so there is nothing to write. */
  isSame: (left: Doc, right: Doc) => boolean
  serialize: (doc: Doc) => string
  emit: (markdown: string) => void
}

export interface MarkdownChangeBuffer<Doc> {
  /** A change to write once the editing pauses. */
  schedule: (doc: Doc) => void
  /** The editor shows a new document (opened or replaced): the new starting point, with nothing pending. */
  reset: (doc: Doc) => void
  /** Writes what is pending now. */
  flush: () => void
  /** Forgets what is pending. */
  cancel: () => void
  hasPending: () => boolean
}

export function createMarkdownChangeBuffer<Doc>({
  delayMs = MARKDOWN_CHANGE_DEBOUNCE_MS,
  maxWaitMs = MARKDOWN_CHANGE_MAX_WAIT_MS,
  isSame,
  serialize,
  emit,
}: MarkdownChangeBufferOptions<Doc>): MarkdownChangeBuffer<Doc> {
  let pending: Doc | null = null
  let last: Doc | null = null
  let pendingSince = 0
  let timer: ReturnType<typeof setTimeout> | null = null

  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer)
    timer = null
  }

  const flush = () => {
    clearTimer()
    const doc = pending
    pending = null
    if (doc === null) return
    // A change that leaves the note as it was (a letter typed and deleted,
    // a stored mark) writes nothing, as Milkdown's listener did.
    if (last === null || isSame(last, doc)) {
      last = doc
      return
    }
    const markdown = serialize(doc)
    last = doc
    emit(markdown)
  }

  const schedule = (doc: Doc) => {
    if (pending === null) pendingSince = Date.now()
    pending = doc
    clearTimer()
    timer = setTimeout(flush, Math.max(0, Math.min(delayMs, pendingSince + maxWaitMs - Date.now())))
  }

  const reset = (doc: Doc) => {
    clearTimer()
    pending = null
    last = doc
  }

  const cancel = () => {
    clearTimer()
    pending = null
  }

  return { schedule, reset, flush, cancel, hasPending: () => pending !== null }
}

interface MarkdownChangeState {
  /** The document of the last change to write, or the one the editor opened with. */
  doc: ProseNode
  changed: boolean
}

const markdownChangeKey = new PluginKey<MarkdownChangeState>('notia-markdown-change')

/** Whether a transaction is a change of the note to write, as Milkdown's listener decided. */
export function isMarkdownChange(transaction: { docChanged: boolean; storedMarksSet: boolean; getMeta: (key: string) => unknown }): boolean {
  // What stays out of the history (the shared room's remote edits, the page
  // breaks) is not the person's change.
  return (transaction.docChanged || transaction.storedMarksSet) && transaction.getMeta('addToHistory') !== false
}

/**
 * Feeds the buffer: each change of the person waits for the pause; a new
 * document (the note opened or replaced from outside) is the new starting
 * point and drops what was pending. Losing focus writes at once.
 */
export function createMarkdownChangePlugin(buffer: Pick<MarkdownChangeBuffer<ProseNode>, 'schedule' | 'reset' | 'flush'>): Plugin {
  return new Plugin<MarkdownChangeState>({
    key: markdownChangeKey,
    state: {
      init: (_config, state) => ({ doc: state.doc, changed: false }),
      apply: (transaction, value) => (isMarkdownChange(transaction) ? { doc: transaction.doc, changed: true } : value),
    },
    view: (view) => {
      // The view is made again when the state is replaced; a state that
      // kept its changes (the shared room reconfiguring it) keeps them pending.
      const initial = markdownChangeKey.getState(view.state)
      if (initial && !initial.changed) buffer.reset(initial.doc)
      return {
        update: (updatedView, previousState) => {
          const next = markdownChangeKey.getState(updatedView.state)
          if (!next || next === markdownChangeKey.getState(previousState)) return
          if (next.changed) buffer.schedule(next.doc)
          else buffer.reset(next.doc)
        },
      }
    },
    props: {
      handleDOMEvents: {
        blur: () => {
          buffer.flush()
          return false
        },
      },
    },
  })
}
