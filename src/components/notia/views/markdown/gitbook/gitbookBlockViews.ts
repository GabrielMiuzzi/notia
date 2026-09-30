import type { Node as ProseMirrorNode } from '@milkdown/kit/prose/model'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView, NodeView } from '@milkdown/kit/prose/view'
import { HINT_STYLES, MAX_GITBOOK_COLUMNS, isHintStyle, type HintStyle } from '../../../../../engines/markdown/gitbookMarkdown'
import {
  CONTROLS_CLASS,
  childPosition,
  controls,
  el,
  field,
  iconButton,
  iconSpan,
  openPopover,
  setNodeAttrs,
  switchButton,
  syncField,
  textButton,
  toggleButton,
} from './gitbookDom'
import { iconMarkup } from './gitbookIcons'
import type { GitbookViewEnvironment } from './gitbookViewEnvironment'
import { GITBOOK_SCHEMA_NAMES } from './gitbookSchema'

/*
 * Node views of the GitBook blocks that hold other blocks. The editable
 * content goes in `contentDOM`; around it, controls change the attributes of
 * the block (style, titles, dates…) or add and remove its parts.
 */

export type GetPos = () => number | undefined

const HINT_LABELS: Record<HintStyle, string> = {
  info: 'Información',
  success: 'Éxito',
  warning: 'Advertencia',
  danger: 'Error',
}

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

/** `2026-09-28` as «28 sep 2026»; anything else as it is. */
function displayDate(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  const month = match ? MONTHS[Number(match[2]) - 1] : undefined
  return match && month ? `${Number(match[3])} ${month} ${match[1]}` : date
}

const TAG_TONES: Record<string, string> = {
  nuevo: 'accent-text', nueva: 'accent-text', new: 'accent-text',
  mejora: 'periwinkle', improvement: 'periwinkle',
  arreglo: 'amber', fix: 'amber', 'corrección': 'amber',
  eliminado: 'coral', removed: 'coral',
}
const TONE_CYCLE = ['accent-text', 'periwinkle', 'amber', 'violet', 'sage', 'gold']

/** The palette token (`--color-…`) a tag is painted with: always the same for the same word. */
function tagTone(tag: string): string {
  const word = tag.trim().toLowerCase()
  const known = TAG_TONES[word]
  if (known) return known
  let hash = 0
  for (const char of word) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return TONE_CYCLE[hash % TONE_CYCLE.length] ?? 'accent-text'
}

function splitTags(tags: string): string[] {
  return tags.split(',').map((tag) => tag.trim()).filter(Boolean)
}

const CONDITION_LABELS = {
  satisfied: 'Se cumple',
  notSatisfied: 'No se cumple',
  dependsOnReader: 'Depende del lector',
  invalid: 'Expresión no válida',
} as const

function isControlTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest(`.${CONTROLS_CLASS}, input, textarea, select`))
}

export abstract class GitbookContainerView implements NodeView {
  dom: HTMLElement
  contentDOM: HTMLElement

  constructor(
    protected node: ProseMirrorNode,
    protected view: EditorView,
    protected getPos: GetPos,
    protected env: GitbookViewEnvironment,
    className: string,
  ) {
    this.dom = el('div', { className: `notia-gb ${className}` })
    this.contentDOM = el('div', { className: 'notia-gb__content' })
  }

  update(node: ProseMirrorNode): boolean {
    if (node.type !== this.node.type) return false
    this.node = node
    this.render()
    return true
  }

  abstract render(): void

  stopEvent(event: Event): boolean {
    return isControlTarget(event.target)
  }

  ignoreMutation(mutation: MutationRecord | { type: 'selection'; target: Node }): boolean {
    if (mutation.type === 'selection') return false
    if (mutation.type === 'attributes' && mutation.target === this.dom) return true
    return !this.contentDOM.contains(mutation.target)
  }

  protected setAttrs(attrs: Record<string, unknown>): void {
    setNodeAttrs(this.view, this.getPos, this.node, attrs)
  }

  /** Adds a part (tab, step, column, update) at `index`, or at the end. */
  protected insertPart(attrs: Record<string, unknown>, index = this.node.childCount): number | null {
    const pos = this.getPos()
    const partType = this.node.type.contentMatch.defaultType
    const paragraph = this.view.state.schema.nodes.paragraph
    if (pos === undefined || !partType || !paragraph) return null
    const insertAt = childPosition(this.node, pos, index)
    const part = partType.create(attrs, paragraph.create())
    const tr = this.view.state.tr.insert(insertAt, part)
    tr.setSelection(TextSelection.near(tr.doc.resolve(insertAt + 2)))
    this.view.dispatch(tr.scrollIntoView())
    this.view.focus()
    return insertAt
  }

  protected removePart(index: number): void {
    const pos = this.getPos()
    if (pos === undefined || this.node.childCount <= 1) return
    const from = childPosition(this.node, pos, index)
    this.view.dispatch(this.view.state.tr.delete(from, from + this.node.child(index).nodeSize))
  }

  protected focusPart(index: number): void {
    const pos = this.getPos()
    if (pos === undefined || index >= this.node.childCount) return
    const from = childPosition(this.node, pos, index)
    const tr = this.view.state.tr.setSelection(TextSelection.near(this.view.state.doc.resolve(from + 1)))
    this.view.dispatch(tr)
    this.view.focus()
  }
}

/**
 * Parts of a block (tab, step, column, update): their own view, so the
 * `data-active` or `data-index` their parent paints on them is not read back
 * as an edit.
 */
export class GitbookPartView implements NodeView {
  dom: HTMLElement
  contentDOM: HTMLElement
  private header: HTMLElement | null = null
  private dateField: HTMLInputElement | HTMLTextAreaElement | null = null
  private tagsField: HTMLInputElement | HTMLTextAreaElement | null = null
  private summary: HTMLButtonElement | null = null

  constructor(private node: ProseMirrorNode, private view: EditorView, private getPos: GetPos) {
    const kind = node.type.name.replace('gitbook_', '')
    this.dom = el('div', { className: `notia-gb-part notia-gb-part--${kind}` })
    this.contentDOM = el('div', { className: 'notia-gb-part__content' })
    if (node.type.name === GITBOOK_SCHEMA_NAMES.update) {
      // An update shows its date and tags; a press on them edits them.
      this.dateField = field(String(node.attrs.date ?? ''), { label: 'Fecha', type: 'date' }, (date) => this.setAttrs({ date }))
      this.tagsField = field(String(node.attrs.tags ?? ''), { label: 'Etiquetas', placeholder: 'Etiquetas (separadas por coma)' }, (tags) => this.setAttrs({ tags }))
      this.summary = el('button', { className: 'notia-gb-update__summary', attrs: { type: 'button', 'aria-label': 'Editar la fecha y las etiquetas' } })
      this.summary.addEventListener('mousedown', (event) => event.preventDefault())
      this.summary.addEventListener('click', (event) => {
        event.preventDefault()
        this.setEditing(true)
        this.dateField?.focus()
      })
      this.header = controls('notia-gb-part__header', [
        this.summary,
        el('label', { className: 'notia-gb-update__field notia-gb-update__date' }, [iconSpan('calendar', 'notia-gb-icon', 13), this.dateField]),
        el('label', { className: 'notia-gb-update__field notia-gb-update__tags' }, [el('span', { className: 'notia-gb-update__dot', attrs: { 'aria-hidden': 'true' } }), this.tagsField]),
      ])
      this.header.addEventListener('focusout', (event) => {
        if (!this.header?.contains(event.relatedTarget as Node | null)) this.setEditing(false)
      })
      this.dom.dataset.editing = 'false'
      this.renderUpdate()
    }
    if (node.type.name !== GITBOOK_SCHEMA_NAMES.tab) {
      const label = node.type.name === GITBOOK_SCHEMA_NAMES.step ? 'Quitar paso'
        : node.type.name === GITBOOK_SCHEMA_NAMES.column ? 'Quitar columna' : 'Quitar novedad'
      const remove = iconButton('notia-remove', label, () => this.remove(), 'notia-gb-part__remove')
      if (this.header) this.header.append(remove)
      else this.header = controls('notia-gb-part__header', [remove])
    }
    this.dom.append(...[this.header, this.contentDOM].filter((part): part is HTMLElement => part !== null))
  }

  update(node: ProseMirrorNode): boolean {
    if (node.type !== this.node.type) return false
    this.node = node
    if (this.dateField) syncField(this.dateField, String(node.attrs.date ?? ''))
    if (this.tagsField) syncField(this.tagsField, String(node.attrs.tags ?? ''))
    if (this.summary) this.renderUpdate()
    return true
  }

  private setEditing(editing: boolean): void {
    this.dom.dataset.editing = String(editing)
  }

  /** The date and tag chips of an update, and the color of its dot. */
  private renderUpdate(): void {
    const date = String(this.node.attrs.date ?? '')
    const tags = splitTags(String(this.node.attrs.tags ?? ''))
    const tone = `var(--color-${tagTone(tags[0] ?? '')})`
    this.dom.style.setProperty('--notia-gb-tone', tags.length > 0 ? tone : 'var(--color-accent-text)')
    this.summary?.replaceChildren(
      el('span', { className: 'notia-gb-update__date-text', text: date ? displayDate(date) : 'Sin fecha' }),
      ...tags.map((tag) => {
        const chip = el('span', { className: 'notia-gb-update__tag', text: tag })
        chip.style.setProperty('--notia-gb-tone', `var(--color-${tagTone(tag)})`)
        return chip
      }),
    )
  }

  stopEvent(event: Event): boolean {
    return isControlTarget(event.target)
  }

  ignoreMutation(mutation: MutationRecord | { type: 'selection'; target: Node }): boolean {
    if (mutation.type === 'selection') return false
    if (mutation.type === 'attributes' && mutation.target === this.dom) return true
    return !this.contentDOM.contains(mutation.target)
  }

  private setAttrs(attrs: Record<string, unknown>): void {
    setNodeAttrs(this.view, this.getPos, this.node, attrs)
  }

  private remove(): void {
    const pos = this.getPos()
    if (pos === undefined) return
    const $pos = this.view.state.doc.resolve(pos)
    // The last part goes with its block.
    if ($pos.parent.childCount <= 1) {
      const parentPos = $pos.before()
      this.view.dispatch(this.view.state.tr.delete(parentPos, parentPos + $pos.parent.nodeSize))
    } else {
      this.view.dispatch(this.view.state.tr.delete(pos, pos + this.node.nodeSize))
    }
  }
}

export class HintView extends GitbookContainerView {
  private styleButton: HTMLButtonElement
  private title: HTMLElement

  constructor(node: ProseMirrorNode, view: EditorView, getPos: GetPos, env: GitbookViewEnvironment) {
    super(node, view, getPos, env, 'notia-gb-hint')
    this.styleButton = iconButton('info', 'Tipo de aviso', () => this.chooseStyle(), 'notia-gb-hint__style')
    // The kind of hint heads its text: «Información», «Éxito»…
    this.title = el('span', { className: 'notia-gb-hint__title' })
    this.dom.append(
      controls('notia-gb-hint__aside', [this.styleButton]),
      el('div', { className: 'notia-gb-hint__body' }, [controls('notia-gb-hint__heading', [this.title]), this.contentDOM]),
    )
    this.render()
  }

  render(): void {
    const style: HintStyle = isHintStyle(this.node.attrs.style) ? this.node.attrs.style : 'info'
    this.dom.dataset.style = style
    this.title.textContent = HINT_LABELS[style]
    const icon = String(this.node.attrs.icon || style)
    this.styleButton.innerHTML = iconMarkup(icon, 15)
    this.styleButton.setAttribute('aria-label', `Tipo de aviso: ${HINT_LABELS[style]}`)
    this.styleButton.title = `Tipo de aviso: ${HINT_LABELS[style]}`
  }

  private chooseStyle(): void {
    openPopover(this.styleButton, (close) => el('div', { className: 'notia-gb-menu', attrs: { role: 'menu' } }, HINT_STYLES.map((style) => {
      const option = textButton(HINT_LABELS[style], () => {
        close()
        this.setAttrs({ style })
      }, { icon: style, className: `notia-gb-menu__item notia-gb-menu__item--${style}` })
      option.setAttribute('role', 'menuitemradio')
      option.setAttribute('aria-checked', String(this.node.attrs.style === style))
      return option
    })))
  }
}

export class TabsView extends GitbookContainerView {
  private bar: HTMLElement
  private active = 0

  constructor(node: ProseMirrorNode, view: EditorView, getPos: GetPos, env: GitbookViewEnvironment) {
    super(node, view, getPos, env, 'notia-gb-tabs')
    this.bar = controls('notia-gb-tabs__bar')
    this.bar.setAttribute('role', 'tablist')
    this.dom.append(this.bar, this.contentDOM)
    this.render()
  }

  render(): void {
    this.active = Math.min(this.active, this.node.childCount - 1)
    const focused = document.activeElement
    const editingTitle = focused instanceof HTMLInputElement && this.bar.contains(focused)
    if (!editingTitle) this.renderBar()
    this.markActivePart()
    // ProseMirror draws the tabs after this view; mark them once they are there.
    queueMicrotask(() => this.markActivePart())
  }

  private markActivePart(): void {
    ;[...this.contentDOM.children].forEach((part, index) => {
      const active = String(index === this.active)
      if ((part as HTMLElement).dataset.active !== active) (part as HTMLElement).dataset.active = active
    })
  }

  private renderBar(): void {
    const tabs: HTMLElement[] = []
    this.node.forEach((tab, _offset, index) => {
      const title = String(tab.attrs.title ?? '')
      if (index === this.active) {
        const input = field(title, { label: 'Título de la pestaña', placeholder: 'Pestaña sin título', className: 'notia-gb-tabs__title' }, (value) => this.renameTab(index, value))
        input.setAttribute('role', 'tab')
        input.setAttribute('aria-selected', 'true')
        tabs.push(el('div', { className: 'notia-gb-tabs__tab notia-gb-tabs__tab--active' }, [
          input,
          this.node.childCount > 1 ? iconButton('notia-remove', 'Quitar pestaña', () => this.removePart(index), 'notia-gb-tabs__remove') : null,
        ]))
      } else {
        const button = textButton(title || 'Pestaña sin título', () => this.activate(index), { className: 'notia-gb-tabs__tab' })
        button.setAttribute('role', 'tab')
        button.setAttribute('aria-selected', 'false')
        tabs.push(button)
      }
    })
    this.bar.replaceChildren(...tabs, iconButton('notia-add', 'Agregar pestaña', () => this.addTab(), 'notia-gb-tabs__add'))
  }

  private activate(index: number): void {
    this.active = index
    this.render()
    this.focusPart(index)
  }

  private addTab(): void {
    this.active = this.node.childCount
    this.insertPart({ title: `Pestaña ${this.node.childCount + 1}` })
  }

  private renameTab(index: number, title: string): void {
    const pos = this.getPos()
    if (pos === undefined || index >= this.node.childCount) return
    const tabPos = childPosition(this.node, pos, index)
    const tab = this.node.child(index)
    this.view.dispatch(this.view.state.tr.setNodeMarkup(tabPos, undefined, { ...tab.attrs, title }))
  }
}

/** Stepper, columns and updates: their parts in a row or a column and a button to add one. */
export class PartsView extends GitbookContainerView {
  private addButton: HTMLButtonElement
  private count: HTMLElement | null = null

  constructor(node: ProseMirrorNode, view: EditorView, getPos: GetPos, env: GitbookViewEnvironment, private kind: 'stepper' | 'columns' | 'updates') {
    super(node, view, getPos, env, `notia-gb-parts notia-gb-${kind}`)
    const label = kind === 'stepper' ? 'Agregar paso' : kind === 'columns' ? 'Agregar columna' : 'Agregar novedad'
    this.addButton = textButton(label, () => this.add(), { icon: 'notia-add', className: 'notia-gb-parts__add' })
    if (kind === 'columns') this.count = el('span', { className: 'notia-gb-parts__count' })
    this.dom.append(this.contentDOM, controls('notia-gb-parts__footer', [this.addButton, this.count]))
    this.render()
  }

  render(): void {
    this.dom.dataset.count = String(this.node.childCount)
    if (!this.count) return
    this.addButton.disabled = this.node.childCount >= MAX_GITBOOK_COLUMNS
    this.count.textContent = `${this.node.childCount} de ${MAX_GITBOOK_COLUMNS} columnas`
  }

  private add(): void {
    if (this.kind === 'updates') {
      // The newest update goes first, as in a changelog.
      this.insertPart({ date: '', tags: '' }, 0)
    } else {
      this.insertPart({})
    }
  }
}

export class CodeFrameView extends GitbookContainerView {
  private titleField: HTMLInputElement | HTMLTextAreaElement
  private numbersToggle: HTMLButtonElement
  private wrapToggle: HTMLButtonElement
  private copyButton: HTMLButtonElement

  constructor(node: ProseMirrorNode, view: EditorView, getPos: GetPos, env: GitbookViewEnvironment) {
    super(node, view, getPos, env, 'notia-gb-code')
    this.titleField = field(String(node.attrs.title ?? ''), { label: 'Título del código', placeholder: 'Nombre del archivo', className: 'notia-gb-code__title' }, (title) => this.setAttrs({ title }))
    this.numbersToggle = toggleButton('Números', 'notia-steps', Boolean(node.attrs.lineNumbers), (lineNumbers) => this.setAttrs({ lineNumbers }))
    this.numbersToggle.title = 'Números de línea'
    this.wrapToggle = toggleButton('Ajustar', 'notia-wrap', Boolean(node.attrs.wrap), (wrap) => this.setAttrs({ wrap }))
    this.wrapToggle.title = 'Ajustar líneas'
    this.copyButton = textButton('Copiar', () => void copyText(this.copyButton, this.node.textContent), { icon: 'notia-copy' })
    this.dom.append(controls('notia-gb-code__header', [
      el('span', { className: 'notia-gb-code__name' }, [iconSpan('notia-page', 'notia-gb-icon', 14), this.titleField]),
      el('span', { className: 'notia-gb-code__actions' }, [this.numbersToggle, this.wrapToggle, this.copyButton]),
    ]), this.contentDOM)
    this.render()
  }

  render(): void {
    syncField(this.titleField, String(this.node.attrs.title ?? ''))
    this.numbersToggle.setAttribute('aria-pressed', String(Boolean(this.node.attrs.lineNumbers)))
    this.wrapToggle.setAttribute('aria-pressed', String(Boolean(this.node.attrs.wrap)))
    this.dom.dataset.lineNumbers = String(Boolean(this.node.attrs.lineNumbers))
    this.dom.dataset.wrap = String(Boolean(this.node.attrs.wrap))
  }
}

/** Copies `text` and says so on the button for a moment. */
async function copyText(button: HTMLButtonElement, text: string): Promise<void> {
  const label = button.querySelector('span:last-child')
  try {
    await navigator.clipboard.writeText(text)
    if (label) label.textContent = 'Copiado'
  } catch {
    if (label) label.textContent = 'No se pudo copiar'
  }
  window.setTimeout(() => {
    if (label) label.textContent = 'Copiar'
  }, 1600)
}

export class PromptView extends GitbookContainerView {
  private descriptionField: HTMLInputElement | HTMLTextAreaElement
  private copyButton: HTMLButtonElement

  constructor(node: ProseMirrorNode, view: EditorView, getPos: GetPos, env: GitbookViewEnvironment) {
    super(node, view, getPos, env, 'notia-gb-prompt')
    this.descriptionField = field(String(node.attrs.description ?? ''), { label: 'Descripción del prompt', placeholder: 'Qué hace este prompt', className: 'notia-gb-prompt__title' }, (description) => this.setAttrs({ description }))
    this.copyButton = textButton('Copiar', () => void copyText(this.copyButton, this.node.textContent), { icon: 'notia-copy', className: 'notia-gb-prompt__copy' })
    // «Ejecutar» sends the prompt to the side chat, in a new chat.
    const run = textButton('Ejecutar', () => {
      const text = this.node.textContent.trim()
      if (text) this.env.runPrompt(text)
    }, { icon: 'notia-prompt', className: 'notia-gb-prompt__run' })
    const icon = iconSpan(String(node.attrs.icon || 'notia-prompt'), 'notia-gb-prompt__icon', 14)
    this.dom.append(controls('notia-gb-prompt__header', [icon, this.descriptionField, this.copyButton, run]), this.contentDOM)
    this.render()
  }

  render(): void {
    syncField(this.descriptionField, String(this.node.attrs.description ?? ''))
  }
}

export class ConditionView extends GitbookContainerView {
  private expressionField: HTMLInputElement | HTMLTextAreaElement
  private status: HTMLElement
  private unsubscribe: () => void

  constructor(node: ProseMirrorNode, view: EditorView, getPos: GetPos, env: GitbookViewEnvironment) {
    super(node, view, getPos, env, 'notia-gb-condition')
    this.expressionField = field(String(node.attrs.expression ?? ''), { label: 'Condición', placeholder: 'page.vars.plan === "pro"', className: 'notia-gb-mono notia-gb-condition__expression' }, (expression) => this.setAttrs({ expression }))
    this.status = el('span', { className: 'notia-gb-condition__status', attrs: { role: 'status' } })
    this.dom.append(controls('notia-gb-condition__header', [
      el('span', { className: 'notia-gb-condition__if' }, [iconSpan('notia-condition', 'notia-gb-icon', 14), el('span', { text: 'SI' })]),
      this.expressionField,
      this.status,
    ]), this.contentDOM)
    this.unsubscribe = env.resolver.subscribe(() => this.render())
    this.render()
  }

  render(): void {
    const expression = String(this.node.attrs.expression ?? '').trim()
    syncField(this.expressionField, String(this.node.attrs.expression ?? ''))
    const result = expression ? this.env.resolver.get('condition', expression) : undefined
    const state = expression ? result?.state : 'invalid'
    this.dom.dataset.state = state ?? 'pending'
    const label = el('span', { text: state ? CONDITION_LABELS[state] : '…' })
    this.status.replaceChildren(...(state === 'satisfied' ? [iconSpan('check', 'notia-gb-icon', 11), label] : [label]))
  }

  destroy(): void {
    this.unsubscribe()
  }
}

export class DetailsView extends GitbookContainerView {
  private summaryField: HTMLInputElement | HTMLTextAreaElement
  private toggle: HTMLButtonElement
  private openSwitch: HTMLButtonElement
  private expanded = true

  constructor(node: ProseMirrorNode, view: EditorView, getPos: GetPos, env: GitbookViewEnvironment) {
    super(node, view, getPos, env, 'notia-gb-details')
    this.toggle = iconButton('notia-chevron', 'Contraer', () => {
      this.expanded = !this.expanded
      this.render()
    }, 'notia-gb-details__toggle')
    this.summaryField = field(String(node.attrs.summary ?? ''), { label: 'Título del desplegable', placeholder: 'Título del desplegable', className: 'notia-gb-details__summary' }, (summary) => this.setAttrs({ summary }))
    this.openSwitch = switchButton('Abierto al leer', Boolean(node.attrs.open), (open) => this.setAttrs({ open }), 'notia-gb-details__open')
    this.dom.append(controls('notia-gb-details__header', [this.toggle, this.summaryField, this.openSwitch]), this.contentDOM)
    this.render()
  }

  render(): void {
    syncField(this.summaryField, String(this.node.attrs.summary ?? ''))
    this.openSwitch.setAttribute('aria-checked', String(Boolean(this.node.attrs.open)))
    this.dom.dataset.expanded = String(this.expanded)
    this.toggle.setAttribute('aria-expanded', String(this.expanded))
    this.toggle.setAttribute('aria-label', this.expanded ? 'Contraer' : 'Expandir')
    this.toggle.title = this.expanded ? 'Contraer' : 'Expandir'
  }
}
