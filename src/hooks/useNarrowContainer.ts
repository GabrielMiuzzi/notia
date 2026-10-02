import { useLayoutEffect, useState } from 'react'

/**
 * Whether `element` (a module's view, not the window) is narrower than
 * `maxWidth`: the phone layouts of the canvases change their structure, not
 * only their columns, so the view has to know it. Measured before painting,
 * so the first frame already has the right layout. Takes the element from a
 * callback ref: it changes between the loading state and the view.
 */
export function useNarrowContainer(element: HTMLElement | null, maxWidth: number): boolean {
  const [narrow, setNarrow] = useState(false)
  useLayoutEffect(() => {
    if (!element) return undefined
    const measure = (width: number) => setNarrow(width > 0 && width < maxWidth)
    measure(element.getBoundingClientRect().width)
    if (typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1]
      if (entry) measure(entry.contentRect.width)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [element, maxWidth])
  return narrow
}
