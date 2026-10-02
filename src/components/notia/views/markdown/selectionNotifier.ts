import { isSameMarkdownSelection } from '../../../../engines/markdown/selectionEngine'
import type { MarkdownSelectionContext } from '../../../../types/views/markdownSelection'

/*
 * The selection reaches the side chat (its context chip and what the agent
 * sees). Each keystroke fired up to four events (keyup, touchend, mouseup and
 * `selectionchange`), and each one drew the whole shell again. They are
 * gathered into one reading at most every `SELECTION_NOTIFY_MS`, and a
 * selection equal to the last one sent is not sent again.
 */

export const SELECTION_NOTIFY_MS = 150

export interface SelectionNotifierOptions {
  read: () => MarkdownSelectionContext | null
  emit: (selection: MarkdownSelectionContext | null) => void
  delayMs?: number
}

export interface SelectionNotifier {
  /** The selection may have changed: it is read and sent shortly. */
  schedule: () => void
  /** Reads and sends it now. */
  flush: () => void
  /** Sends this selection now, dropping a pending reading. */
  sendNow: (selection: MarkdownSelectionContext | null) => void
  cancel: () => void
}

export function createSelectionNotifier({ read, emit, delayMs = SELECTION_NOTIFY_MS }: SelectionNotifierOptions): SelectionNotifier {
  let hasSent = false
  let last: MarkdownSelectionContext | null = null
  let timer: ReturnType<typeof setTimeout> | null = null

  const cancel = () => {
    if (timer !== null) clearTimeout(timer)
    timer = null
  }

  const sendNow = (selection: MarkdownSelectionContext | null) => {
    cancel()
    if (hasSent && isSameMarkdownSelection(last, selection)) return
    hasSent = true
    last = selection
    emit(selection)
  }

  const flush = () => sendNow(read())

  const schedule = () => {
    timer ??= setTimeout(flush, delayMs)
  }

  return { schedule, flush, sendNow, cancel }
}
