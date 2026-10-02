import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MarkdownSelectionContext } from '../../../../types/views/markdownSelection'
import { createSelectionNotifier, SELECTION_NOTIFY_MS } from './selectionNotifier'

function selection(from: number, text = 'Hola'): MarkdownSelectionContext {
  return {
    documentPath: 'A.md',
    from,
    to: from,
    selectedText: '',
    blocks: [{ index: 0, type: 'párrafo', text, from: 0, to: 6 }],
  }
}

describe('createSelectionNotifier', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('gathers the events of a keystroke into one reading', () => {
    let current = selection(1)
    const read = vi.fn(() => current)
    const emit = vi.fn()
    const notifier = createSelectionNotifier({ read, emit })
    // keyup, touchend and selectionchange of the same keystroke.
    notifier.schedule()
    current = selection(2)
    notifier.schedule()
    notifier.schedule()
    expect(emit).not.toHaveBeenCalled()
    vi.advanceTimersByTime(SELECTION_NOTIFY_MS)
    expect(read).toHaveBeenCalledTimes(1)
    expect(emit).toHaveBeenCalledExactlyOnceWith(selection(2))
  })

  it('does not send a selection equal to the last one', () => {
    const emit = vi.fn()
    const notifier = createSelectionNotifier({ read: () => selection(3), emit })
    notifier.flush()
    notifier.schedule()
    vi.advanceTimersByTime(SELECTION_NOTIFY_MS)
    notifier.sendNow(selection(3))
    expect(emit).toHaveBeenCalledTimes(1)
    // The text of the block changed: that is news.
    notifier.sendNow(selection(3, 'Hola!'))
    expect(emit).toHaveBeenCalledTimes(2)
  })

  it('sends at once when asked, dropping the pending reading', () => {
    const emit = vi.fn()
    const notifier = createSelectionNotifier({ read: () => selection(5), emit })
    notifier.schedule()
    notifier.sendNow(null)
    vi.advanceTimersByTime(SELECTION_NOTIFY_MS)
    expect(emit).toHaveBeenCalledExactlyOnceWith(null)
  })
})
