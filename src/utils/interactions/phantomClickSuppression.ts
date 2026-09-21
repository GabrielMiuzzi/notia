/**
 * Shared suppression of the phantom native click that follows a tap.
 *
 * NotiaButton already forces an activation on `pointerup` (calling
 * `preventDefault()` plus a programmatic `click()`) because the Android
 * WebView can drop trusted clicks when the finger drifts slightly. The
 * platform still dispatches its own native `click` for the same tap; when
 * React renders a modal synchronously inside that handler, the browser
 * retargets the pending native `click` to the freshly mounted backdrop and
 * the modal appears and disappears immediately.
 *
 * Consumers of this module acknowledge the tap gesture that opens their
 * surface. Any trusted `click` dispatched inside the window whose target is
 * not inside the registered element is swallowed at the document capture
 * phase instead of falling through. Untrusted (programmatic) clicks, clicks
 * on the registered element itself, and pointer-free synthetic events used
 * by tests keep working.
 */

const PHANTOM_CLICK_WINDOW_MS = 450
const CAPTURE_LISTENER_EVENT = 'click'

interface PhantomClickGateState {
  until: number
  element: Element | null
  timer: number | null
  listenerInstalled: boolean
}

const state: PhantomClickGateState = {
  until: 0,
  element: null,
  timer: null,
  listenerInstalled: false,
}

function clearTimer(): void {
  if (state.timer !== null) {
    window.clearTimeout(state.timer)
    state.timer = null
  }
}

function reset(): void {
  clearTimer()
  state.until = 0
  state.element = null
}

function handleTrustedClick(event: MouseEvent): void {
  if (!event.isTrusted || Date.now() > state.until) {
    if (Date.now() > state.until) {
      reset()
    }
    return
  }

  const element = state.element
  const target = event.target
  const isInsideOwnedElement =
    element !== null && target instanceof Node && element.contains(target)

  if (isInsideOwnedElement) {
    reset()
    return
  }

  event.preventDefault()
  event.stopPropagation()
}

function ensureDocumentListener(): void {
  if (state.listenerInstalled || typeof document === 'undefined') {
    return
  }

  document.addEventListener(CAPTURE_LISTENER_EVENT, handleTrustedClick, true)
  state.listenerInstalled = true
}

/**
 * Registers the suppression window for the tap that just ended. The gate is
 * owned by the element that received the tap, so a trusted click on the same
 * element re-arms cleanly.
 */
export function beginPhantomClickSuppression(element: Element | null): void {
  if (!element) {
    return
  }

  ensureDocumentListener()
  clearTimer()
  state.until = Date.now() + PHANTOM_CLICK_WINDOW_MS
  state.element = element
  state.timer = window.setTimeout(reset, PHANTOM_CLICK_WINDOW_MS)
}

/** Test-only helper: clears the window immediately. */
export function resetPhantomClickSuppressionForTests(): void {
  reset()
}