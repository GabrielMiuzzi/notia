import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { el, overlayHost } from './gitbookDom'

/*
 * Annotations, as GitBook calls its footnotes: the note of a `[^label]`
 * reference shows next to it when the pointer rests on it or when it is
 * tapped, so a phone reads it without scrolling to the definitions.
 */

const REFERENCE_SELECTOR = 'sup[data-type="footnote_reference"]'
const HOVER_DELAY_MS = 250

function annotationText(view: EditorView, label: string): string | null {
  let text: string | null = null
  view.state.doc.descendants((node) => {
    if (text !== null) return false
    if (node.type.name === 'footnote_definition' && node.attrs.label === label) {
      text = node.textContent.trim()
      return false
    }
    return true
  })
  return text
}

export const gitbookAnnotationsKey = new PluginKey('notiaGitbookAnnotations')

export function createAnnotationsPlugin(): Plugin {
  let bubble: HTMLElement | null = null
  let anchor: HTMLElement | null = null
  let timer: ReturnType<typeof setTimeout> | null = null

  const hide = () => {
    if (timer) clearTimeout(timer)
    timer = null
    bubble?.remove()
    bubble = null
    anchor = null
  }

  const show = (view: EditorView, reference: HTMLElement) => {
    if (anchor === reference && bubble) return
    hide()
    const label = reference.getAttribute('data-label') ?? ''
    const text = annotationText(view, label)
    anchor = reference
    bubble = el('div', { className: 'notia-gb-annotation', attrs: { role: 'tooltip' } }, [
      el('span', { className: 'notia-gb-annotation__label', text: label }),
      el('span', { text: text || 'Esta anotación no tiene texto todavía.' }),
    ])
    overlayHost(view.dom).append(bubble)
    const rect = reference.getBoundingClientRect()
    const width = Math.min(bubble.offsetWidth || 280, window.innerWidth - 16)
    bubble.style.left = `${Math.max(8, Math.min(rect.left - width / 2, window.innerWidth - width - 8))}px`
    const above = rect.top - bubble.offsetHeight - 8
    bubble.style.top = `${above > 8 ? above : rect.bottom + 8}px`
  }

  const referenceOf = (target: EventTarget | null) => (
    target instanceof Element ? target.closest<HTMLElement>(REFERENCE_SELECTOR) : null
  )

  return new Plugin({
    key: gitbookAnnotationsKey,
    props: {
      handleDOMEvents: {
        mouseover: (view, event) => {
          const reference = referenceOf(event.target)
          if (!reference) return false
          if (timer) clearTimeout(timer)
          timer = setTimeout(() => show(view, reference), HOVER_DELAY_MS)
          return false
        },
        mouseout: (_view, event) => {
          if (referenceOf(event.target) && !referenceOf(event.relatedTarget)) hide()
          return false
        },
        click: (view, event) => {
          const reference = referenceOf(event.target)
          if (reference) show(view, reference)
          else hide()
          return false
        },
        keydown: () => {
          hide()
          return false
        },
      },
    },
    view: () => ({
      update: (view) => {
        if (anchor && !view.dom.contains(anchor)) hide()
      },
      destroy: hide,
    }),
  })
}
