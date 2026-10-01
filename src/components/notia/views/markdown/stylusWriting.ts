/*
 * Android tablets turn what the stylus writes over a text field into text
 * (the system's stylus handwriting, also inside the WebView). The stylus
 * still sends pointer events and compatibility mouse events to the page, so
 * the editor took the stroke for a drag: the block marquee selected whole
 * blocks and ProseMirror a range of text, and the recognized text then
 * replaced that selection. On Android, with the selector, the stylus is left
 * to the system: it places the caret and writes, and the editor follows the
 * selection the system sets. Drawing tools keep the stylus for the ink.
 */

/** Whether this interface runs on Android, where the system writes with the stylus. */
export function writesWithStylus(userAgent: string = typeof navigator === 'undefined' ? '' : navigator.userAgent): boolean {
  return /Android/i.test(userAgent)
}

/** A press of the stylus the system may turn into handwriting. */
export function isSystemStylusPress(event: Pick<PointerEvent, 'pointerType'>, android: boolean = writesWithStylus()): boolean {
  return android && event.pointerType === 'pen'
}

/**
 * Keeps ProseMirror from starting its own drag selection under a stylus
 * press while `isEnabled` (the selector is the tool). The compatibility
 * `mousedown` of that press stops at `host`; its default action still
 * places the caret, which ProseMirror reads from the document selection.
 */
export function leaveStylusToSystem(host: HTMLElement, isEnabled: () => boolean, android: boolean = writesWithStylus()): () => void {
  if (!android) return () => {}
  let stylusDown = false
  const onPointerDown = (event: PointerEvent) => {
    stylusDown = isEnabled() && isSystemStylusPress(event, android)
  }
  const onMouseDown = (event: MouseEvent) => {
    if (stylusDown) event.stopPropagation()
  }
  const onPointerEnd = (event: PointerEvent) => {
    if (event.pointerType === 'pen') stylusDown = false
  }
  host.addEventListener('pointerdown', onPointerDown, true)
  host.addEventListener('mousedown', onMouseDown, true)
  host.addEventListener('pointerup', onPointerEnd, true)
  host.addEventListener('pointercancel', onPointerEnd, true)
  return () => {
    host.removeEventListener('pointerdown', onPointerDown, true)
    host.removeEventListener('mousedown', onMouseDown, true)
    host.removeEventListener('pointerup', onPointerEnd, true)
    host.removeEventListener('pointercancel', onPointerEnd, true)
  }
}
