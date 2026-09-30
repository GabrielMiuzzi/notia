import type { Node as ProseMirrorNode } from '@milkdown/kit/prose/model'
import type { EditorView } from '@milkdown/kit/prose/view'
import { iconMarkup } from './gitbookIcons'

/*
 * DOM pieces the GitBook node views share. Controls stay out of the editable
 * text (`contenteditable=false`) and keep the editor's selection when they
 * are pressed; every control is a real button or input, so it works by touch
 * and keyboard alike.
 */

/** Class of the parts of a node view that ProseMirror must leave alone. */
export const CONTROLS_CLASS = 'notia-gb-controls'

interface ElementOptions {
  className?: string
  text?: string
  attrs?: Record<string, string>
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: ElementOptions = {},
  children: Array<Node | string | null | undefined> = [],
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag)
  if (options.className) element.className = options.className
  if (options.text !== undefined) element.textContent = options.text
  Object.entries(options.attrs ?? {}).forEach(([name, value]) => element.setAttribute(name, value))
  children.forEach((child) => {
    if (child !== null && child !== undefined) element.append(child)
  })
  return element
}

/** The items that are there. */
export function present<T>(items: Array<T | null | undefined>): T[] {
  return items.filter((item): item is T => item !== null && item !== undefined)
}

/** A group of controls inside a node view. */
export function controls(className: string, children: Array<Node | null | undefined> = []): HTMLElement {
  return el('div', { className: `${CONTROLS_CLASS} ${className}`, attrs: { contenteditable: 'false' } }, children)
}

export function iconSpan(name: string, className = 'notia-gb-icon', size = 16): HTMLSpanElement {
  const span = el('span', { className, attrs: { 'aria-hidden': 'true' } })
  span.innerHTML = iconMarkup(name, size)
  return span
}

/** Keeps the editor's selection when a control is pressed. */
function keepSelection(element: HTMLElement): void {
  element.addEventListener('mousedown', (event) => event.preventDefault())
}

export function iconButton(icon: string, label: string, onClick: (event: MouseEvent) => void, className = ''): HTMLButtonElement {
  const button = el('button', {
    className: `notia-gb-button-icon ${className}`.trim(),
    attrs: { type: 'button', 'aria-label': label, title: label },
  })
  button.innerHTML = iconMarkup(icon, 16)
  keepSelection(button)
  button.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    onClick(event)
  })
  return button
}

export function textButton(label: string, onClick: (event: MouseEvent) => void, options: { icon?: string; className?: string } = {}): HTMLButtonElement {
  const button = el('button', { className: `notia-gb-text-button ${options.className ?? ''}`.trim(), attrs: { type: 'button' } })
  if (options.icon) button.append(iconSpan(options.icon))
  button.append(el('span', { text: label }))
  keepSelection(button)
  button.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    onClick(event)
  })
  return button
}

export function toggleButton(label: string, icon: string, pressed: boolean, onToggle: (pressed: boolean) => void): HTMLButtonElement {
  const button = textButton(label, () => onToggle(button.getAttribute('aria-pressed') !== 'true'), { icon, className: 'notia-gb-toggle' })
  button.setAttribute('aria-pressed', String(pressed))
  return button
}

/** A labelled on/off switch: the label, then the track with its knob. */
export function switchButton(label: string, checked: boolean, onToggle: (checked: boolean) => void, className = ''): HTMLButtonElement {
  const button = el('button', { className: `notia-gb-switch ${className}`.trim(), attrs: { type: 'button', role: 'switch' } }, [
    el('span', { text: label }),
    el('span', { className: 'notia-gb-switch__track', attrs: { 'aria-hidden': 'true' } }, [el('span', { className: 'notia-gb-switch__knob' })]),
  ])
  button.setAttribute('aria-checked', String(checked))
  keepSelection(button)
  button.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    onToggle(button.getAttribute('aria-checked') !== 'true')
  })
  return button
}

interface InputOptions {
  label: string
  placeholder?: string
  type?: string
  className?: string
  multiline?: boolean
}

/**
 * A field that commits when it loses focus or on Enter, and goes back to the
 * saved value on Escape, so typing does not write one history step per key.
 */
export function field(value: string, options: InputOptions, onCommit: (value: string) => void): HTMLInputElement | HTMLTextAreaElement {
  const input = options.multiline
    ? el('textarea', { className: `notia-gb-field ${options.className ?? ''}`.trim(), attrs: { rows: '2' } })
    : el('input', { className: `notia-gb-field ${options.className ?? ''}`.trim(), attrs: { type: options.type ?? 'text' } })
  input.value = value
  input.setAttribute('aria-label', options.label)
  input.setAttribute('placeholder', options.placeholder ?? options.label)
  input.setAttribute('spellcheck', 'false')
  let saved = value
  const commit = () => {
    if (input.value === saved) return
    saved = input.value
    onCommit(input.value)
  }
  input.addEventListener('change', commit)
  input.addEventListener('blur', commit)
  input.addEventListener('keydown', (event) => {
    const key = (event as KeyboardEvent).key
    if (key === 'Enter' && !(options.multiline && (event as KeyboardEvent).shiftKey)) {
      event.preventDefault()
      commit()
      input.blur()
    } else if (key === 'Escape') {
      input.value = saved
      input.blur()
    }
  })
  return input
}

/** Sets the value of a field that is not being edited. */
export function syncField(input: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  if (document.activeElement !== input && input.value !== value) input.value = value
}

export function select(value: string, label: string, options: Array<[string, string]>, onChange: (value: string) => void): HTMLSelectElement {
  const element = el('select', { className: 'notia-gb-field notia-gb-select', attrs: { 'aria-label': label } })
  options.forEach(([optionValue, optionLabel]) => element.append(el('option', { text: optionLabel, attrs: { value: optionValue } })))
  element.value = value
  element.addEventListener('change', () => onChange(element.value))
  return element
}

/** Opens a web address outside Notia. */
export function openExternal(url: string): void {
  const anchor = el('a', { attrs: { href: url, target: '_blank', rel: 'noopener noreferrer' } })
  anchor.click()
}

export function isWebAddress(url: string): boolean {
  return /^(https?:|mailto:)/i.test(url.trim())
}

/** Replaces some attributes of the node at `getPos()`. */
export function setNodeAttrs(
  view: EditorView,
  getPos: () => number | undefined,
  node: ProseMirrorNode,
  attrs: Record<string, unknown>,
): void {
  const pos = getPos()
  if (pos === undefined) return
  const current = view.state.doc.nodeAt(pos)
  if (!current || current.type !== node.type) return
  view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, ...attrs }))
}

/** Position of the `index`-th child of the node at `pos`. */
export function childPosition(node: ProseMirrorNode, pos: number, index: number): number {
  let offset = pos + 1
  for (let child = 0; child < index; child += 1) offset += node.child(child).nodeSize
  return offset
}

/** Where fixed-position pieces go: inside the app shell, so they get the theme tokens. */
export function overlayHost(from: HTMLElement | null): HTMLElement {
  return from?.closest<HTMLElement>('.notia-app-shell') ?? document.querySelector<HTMLElement>('.notia-app-shell') ?? document.body
}

/**
 * A small panel under `anchor` with its own controls. It closes with Escape,
 * or a press outside, and follows its anchor when the window is resized.
 */
export function openPopover(anchor: HTMLElement, build: (close: () => void) => HTMLElement): () => void {
  const panel = el('div', { className: 'notia-gb-popover', attrs: { role: 'dialog' } })
  const host = overlayHost(anchor)
  let closed = false
  const close = () => {
    if (closed) return
    closed = true
    panel.remove()
    document.removeEventListener('pointerdown', onOutside, true)
    document.removeEventListener('keydown', onKey, true)
    window.removeEventListener('resize', place)
  }
  const onOutside = (event: PointerEvent) => {
    if (!panel.contains(event.target as Node) && !anchor.contains(event.target as Node)) close()
  }
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      close()
    }
  }
  // A phone's keyboard resizes the window: the panel moves, it does not close.
  const place = () => {
    const rect = anchor.getBoundingClientRect()
    const width = Math.min(panel.offsetWidth || 280, window.innerWidth - 16)
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))
    const below = rect.bottom + 6
    const fitsBelow = below + panel.offsetHeight < window.innerHeight - 8
    panel.style.left = `${left}px`
    panel.style.top = `${fitsBelow ? below : Math.max(8, rect.top - panel.offsetHeight - 6)}px`
  }
  panel.append(build(close))
  host.append(panel)
  place()
  document.addEventListener('pointerdown', onOutside, true)
  document.addEventListener('keydown', onKey, true)
  window.addEventListener('resize', place)
  panel.querySelector<HTMLElement>('input, textarea, select, button')?.focus()
  return close
}
