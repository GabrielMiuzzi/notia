import type { Node as ProseMirrorNode } from '@milkdown/kit/prose/model'
import type { EditorView, NodeView } from '@milkdown/kit/prose/view'
import { BUTTON_VARIANTS, type GitbookCard } from '../../../../../engines/markdown/gitbookMarkdown'
import {
  CONTROLS_CLASS,
  controls,
  el,
  field,
  iconButton,
  iconSpan,
  isWebAddress,
  openExternal,
  openPopover,
  present,
  select,
  setNodeAttrs,
  syncField,
  textButton,
} from './gitbookDom'
import { iconMarkup } from './gitbookIcons'
import type { GitbookViewEnvironment } from './gitbookViewEnvironment'
import type { GetPos } from './gitbookBlockViews'

/*
 * Node views of the GitBook blocks and inline elements that hold no text of
 * their own: embeds, files, page links, reusable content, cards, drawings,
 * buttons, icons, expressions and line-size images. Each shows what it
 * points to (resolved in Rust) and edits its attributes with its own fields.
 */

function isControlTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest(`.${CONTROLS_CLASS}, input, textarea, select, button, a`))
}

function fileName(path: string): string {
  const name = path.split(/[?#]/)[0]?.split('/').filter(Boolean).pop() ?? path
  try {
    return decodeURIComponent(name)
  } catch {
    return name
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

function youtubeId(url: string): string | null {
  const match = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{6,})/.exec(url)
  return match?.[1] ?? null
}

/** Opens what a reference points to: a web address outside Notia, a library file in a tab. */
function openReference(env: GitbookViewEnvironment, reference: string): void {
  if (isWebAddress(reference)) {
    openExternal(reference)
    return
  }
  const result = env.resolver.get('reference', reference)
  if (result?.kind === 'library' && result.target && result.exists) env.openLibraryPath(result.target)
}

/** Where an `<img>` loads an image from, or `null` while it is being resolved or when it is missing. */
function imageSource(env: GitbookViewEnvironment, source: string): string | null {
  if (/^(data:image\/|https?:)/i.test(source)) return source
  if (!source) return null
  const result = env.resolver.get('reference', source)
  return result?.kind === 'library' && result.target && result.exists ? env.fileUrl(result.target) : null
}

abstract class GitbookAtomView implements NodeView {
  dom: HTMLElement
  protected editing = false
  private unsubscribe: () => void

  constructor(
    protected node: ProseMirrorNode,
    protected view: EditorView,
    protected getPos: GetPos,
    protected env: GitbookViewEnvironment,
    className: string,
    tag: 'div' | 'span' = 'div',
  ) {
    this.dom = el(tag, { className: `notia-gb ${tag === 'div' ? 'notia-gb-atom' : 'notia-gb-inline'} ${className}`, attrs: { contenteditable: 'false' } })
    this.unsubscribe = env.resolver.subscribe(() => this.render())
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

  ignoreMutation(): boolean {
    return true
  }

  selectNode(): void {
    this.dom.classList.add('ProseMirror-selectednode')
  }

  deselectNode(): void {
    this.dom.classList.remove('ProseMirror-selectednode')
  }

  destroy(): void {
    this.unsubscribe()
  }

  protected attr(name: string): string {
    const value: unknown = this.node.attrs[name]
    return typeof value === 'string' ? value : ''
  }

  protected setAttrs(attrs: Record<string, unknown>): void {
    setNodeAttrs(this.view, this.getPos, this.node, attrs)
  }

  protected setEditing(editing: boolean): void {
    this.editing = editing
    this.dom.dataset.editing = String(editing)
    this.dom.replaceChildren()
    this.render()
    if (editing) this.dom.querySelector<HTMLElement>('input, textarea')?.focus()
  }

  protected editButton(label = 'Editar'): HTMLButtonElement {
    return iconButton('notia-edit', label, () => this.setEditing(true))
  }

  protected doneButton(): HTMLButtonElement {
    return textButton('Listo', () => this.setEditing(false), { className: 'notia-gb-primary' })
  }
}

/** Blocks edited through a few fields: the fields are built once and kept while editing. */
abstract class GitbookFieldsView extends GitbookAtomView {
  private fields = new Map<string, HTMLInputElement | HTMLTextAreaElement>()

  protected abstract fieldSpecs(): Array<{ name: string; label: string; placeholder?: string }>
  protected abstract renderDisplay(): void

  render(): void {
    if (!this.editing) {
      this.fields.clear()
      this.renderDisplay()
      return
    }
    if (this.fields.size === 0) {
      const inputs = this.fieldSpecs().map((spec) => {
        const input = field(this.attr(spec.name), { label: spec.label, placeholder: spec.placeholder }, (value) => this.setAttrs({ [spec.name]: value.trim() }))
        this.fields.set(spec.name, input)
        return el('label', { className: 'notia-gb-form__row' }, [el('span', { text: spec.label }), input])
      })
      this.dom.replaceChildren(controls('notia-gb-form', [...inputs, el('div', { className: 'notia-gb-form__actions' }, [this.doneButton()])]))
      return
    }
    this.fields.forEach((input, name) => syncField(input, this.attr(name)))
  }
}

export class EmbedView extends GitbookFieldsView {
  constructor(node: ProseMirrorNode, view: EditorView, getPos: GetPos, env: GitbookViewEnvironment) {
    super(node, view, getPos, env, 'notia-gb-embed')
    this.editing = !this.attr('url')
    this.render()
  }

  protected fieldSpecs() {
    return [
      { name: 'url', label: 'Dirección', placeholder: 'https://…' },
      { name: 'caption', label: 'Leyenda' },
    ]
  }

  protected renderDisplay(): void {
    const url = this.attr('url')
    const video = youtubeId(url)
    const thumbnail = video ? el('img', { className: 'notia-gb-embed__thumbnail', attrs: { src: `https://img.youtube.com/vi/${video}/hqdefault.jpg`, alt: '', loading: 'lazy' } }) : null
    this.dom.replaceChildren(
      thumbnail ?? iconSpan('notia-embed', 'notia-gb-atom__icon', 20),
      el('div', { className: 'notia-gb-atom__text' }, [
        el('strong', { text: this.attr('caption') || hostOf(url) || 'URL embebida' }),
        el('span', { className: 'notia-gb-atom__detail', text: url }),
      ]),
      controls('notia-gb-atom__actions', [
        isWebAddress(url) ? iconButton('notia-open', 'Abrir en el navegador', () => openExternal(url)) : null,
        this.editButton('Editar URL embebida'),
      ]),
    )
  }
}

export class FileView extends GitbookFieldsView {
  constructor(node: ProseMirrorNode, view: EditorView, getPos: GetPos, env: GitbookViewEnvironment) {
    super(node, view, getPos, env, 'notia-gb-file')
    this.editing = !this.attr('src')
    this.render()
  }

  protected fieldSpecs() {
    return [
      { name: 'src', label: 'Archivo', placeholder: 'Ruta en la biblioteca o dirección web' },
      { name: 'caption', label: 'Leyenda' },
    ]
  }

  protected renderDisplay(): void {
    const src = this.attr('src')
    const result = isWebAddress(src) ? undefined : this.env.resolver.get('reference', src)
    const missing = result !== undefined && (!result.exists || result.kind === 'invalid')
    this.dom.dataset.missing = String(missing)
    this.dom.replaceChildren(
      iconSpan('notia-file', 'notia-gb-atom__icon', 20),
      el('div', { className: 'notia-gb-atom__text' }, [
        el('strong', { text: fileName(src) || 'Archivo' }),
        el('span', { className: 'notia-gb-atom__detail', text: missing ? 'No se encontró el archivo' : this.attr('caption') }),
      ]),
      controls('notia-gb-atom__actions', [
        missing ? null : iconButton('notia-open', 'Abrir archivo', () => openReference(this.env, src)),
        this.editButton('Editar archivo'),
      ]),
    )
  }
}

export class ContentRefView extends GitbookFieldsView {
  constructor(node: ProseMirrorNode, view: EditorView, getPos: GetPos, env: GitbookViewEnvironment) {
    super(node, view, getPos, env, 'notia-gb-page-link')
    this.editing = !this.attr('url')
    this.render()
  }

  protected fieldSpecs() {
    return [
      { name: 'url', label: 'Página', placeholder: 'otra-nota.md o carpeta/' },
      { name: 'label', label: 'Texto del enlace' },
    ]
  }

  protected renderDisplay(): void {
    const url = this.attr('url')
    const result = isWebAddress(url) ? undefined : this.env.resolver.get('reference', url)
    const missing = result !== undefined && (!result.exists || result.kind === 'invalid')
    const title = result?.title || this.attr('label') || url
    this.dom.dataset.missing = String(missing)
    const open = el('button', { className: 'notia-gb-page-link__open', attrs: { type: 'button' } }, [
      iconSpan('notia-page', 'notia-gb-atom__icon', 20),
      el('span', { className: 'notia-gb-atom__text' }, [
        el('strong', { text: title || 'Enlace a página' }),
        el('span', { className: 'notia-gb-atom__detail', text: missing ? `No se encontró ${url}` : url }),
      ]),
    ])
    open.disabled = missing
    open.addEventListener('mousedown', (event) => event.preventDefault())
    open.addEventListener('click', () => openReference(this.env, url))
    this.dom.replaceChildren(controls('notia-gb-page-link__row', [open, this.editButton('Editar enlace a página')]))
  }
}

export class IncludeView extends GitbookFieldsView {
  private removePreview: (() => void) | null = null
  private previewMarkdown: string | null = null
  private preview = el('div', { className: 'notia-gb-include__preview' })

  constructor(node: ProseMirrorNode, view: EditorView, getPos: GetPos, env: GitbookViewEnvironment) {
    super(node, view, getPos, env, 'notia-gb-include')
    this.editing = !this.attr('reference')
    this.render()
  }

  protected fieldSpecs() {
    return [{ name: 'reference', label: 'Nota reutilizable', placeholder: '../.gitbook/includes/bloque.md' }]
  }

  protected renderDisplay(): void {
    const reference = this.attr('reference')
    const result = this.env.resolver.get('include', reference)
    const target = result?.target ?? null
    this.dom.replaceChildren(
      controls('notia-gb-include__header', [
        iconSpan('notia-include'),
        el('span', { className: 'notia-gb-label', text: 'Contenido reutilizable' }),
        el('span', { className: 'notia-gb-atom__detail', text: result?.title ?? reference }),
        target && !result?.error ? iconButton('notia-open', 'Abrir nota reutilizable', () => this.env.openLibraryPath(target)) : null,
        iconButton('notia-undo', 'Actualizar', () => this.env.resolver.invalidate(['include'])),
        this.editButton('Cambiar nota reutilizable'),
      ]),
      this.preview,
    )
    const markdown = result?.error ? null : result?.markdown ?? null
    if (markdown === this.previewMarkdown && this.removePreview) return
    this.removePreview?.()
    this.removePreview = null
    this.previewMarkdown = markdown
    if (result?.error) {
      this.preview.replaceChildren(el('p', { className: 'notia-gb-muted', text: result.error }))
    } else if (markdown === null) {
      this.preview.replaceChildren(el('p', { className: 'notia-gb-muted', text: 'Cargando…' }))
    } else {
      this.preview.replaceChildren()
      this.removePreview = this.env.renderMarkdown(this.preview, markdown)
      if (result?.truncated) this.preview.append(el('p', { className: 'notia-gb-muted', text: 'Vista recortada.' }))
    }
  }

  protected setEditing(editing: boolean): void {
    this.removePreview?.()
    this.removePreview = null
    this.previewMarkdown = null
    super.setEditing(editing)
  }

  destroy(): void {
    this.removePreview?.()
    super.destroy()
  }
}

function readCards(value: string): GitbookCard[] {
  try {
    const cards = JSON.parse(value) as unknown
    return Array.isArray(cards) ? cards as GitbookCard[] : []
  } catch {
    return []
  }
}

export class CardsView extends GitbookAtomView {
  constructor(node: ProseMirrorNode, view: EditorView, getPos: GetPos, env: GitbookViewEnvironment) {
    super(node, view, getPos, env, 'notia-gb-cards')
    this.editing = readCards(this.attr('cards')).length === 0
    this.render()
  }

  private cards(): GitbookCard[] {
    return readCards(this.attr('cards'))
  }

  private saveCards(cards: GitbookCard[]): void {
    this.setAttrs({ cards: JSON.stringify(cards) })
  }

  render(): void {
    if (this.editing) {
      // Rebuilding would drop the focus of a field; only the list shape changes it.
      if (this.dom.querySelector('.notia-gb-cards__editor') && this.dom.querySelectorAll('.notia-gb-cards__edit-card').length === this.cards().length) return
      this.renderEditor()
      return
    }
    const grid = el('div', { className: 'notia-gb-cards__grid' }, this.cards().map((card) => {
      const cover = card.cover ? imageSource(this.env, card.cover) : null
      const tile = el('button', { className: 'notia-gb-card', attrs: { type: 'button' } }, [
        cover ? el('img', { className: 'notia-gb-card__cover', attrs: { src: cover, alt: '', loading: 'lazy' } }) : null,
        card.icon ? iconSpan(card.icon, 'notia-gb-card__icon', 20) : null,
        el('strong', { text: card.title || 'Tarjeta' }),
        card.description ? el('span', { className: 'notia-gb-atom__detail', text: card.description }) : null,
      ])
      tile.disabled = !card.target
      tile.addEventListener('mousedown', (event) => event.preventDefault())
      tile.addEventListener('click', () => openReference(this.env, card.target))
      return tile
    }))
    this.dom.replaceChildren(controls('notia-gb-cards__view', [grid, el('div', { className: 'notia-gb-form__actions' }, [textButton('Editar tarjetas', () => this.setEditing(true), { icon: 'notia-edit' })])]))
  }

  private renderEditor(): void {
    const cards = this.cards()
    const update = (index: number, change: Partial<GitbookCard>) => {
      const next = this.cards()
      const current = next[index]
      if (!current) return
      next[index] = { ...current, ...change }
      this.saveCards(next)
    }
    const rows = cards.map((card, index) => el('fieldset', { className: 'notia-gb-cards__edit-card' }, [
      el('legend', { text: `Tarjeta ${index + 1}` }),
      field(card.title, { label: 'Título' }, (title) => update(index, { title })),
      field(card.description, { label: 'Descripción', multiline: true }, (description) => update(index, { description })),
      field(card.target, { label: 'Enlace', placeholder: 'Página o dirección web' }, (target) => update(index, { target: target.trim() })),
      field(card.icon, { label: 'Ícono', placeholder: 'Ícono (por ejemplo, rocket)' }, (icon) => update(index, { icon: icon.trim().replace(/^fa-/, '') })),
      field(card.cover, { label: 'Portada', placeholder: 'Imagen de portada (opcional)' }, (cover) => update(index, { cover: cover.trim() })),
      iconButton('notia-remove', `Quitar tarjeta ${index + 1}`, () => this.saveCards(this.cards().filter((_card, cardIndex) => cardIndex !== index))),
    ]))
    const add = textButton('Agregar tarjeta', () => {
      this.saveCards([...this.cards(), { title: '', description: '', target: '', cover: '', icon: '' }])
    }, { icon: 'notia-add' })
    this.dom.replaceChildren(controls('notia-gb-cards__editor notia-gb-form', [
      ...rows,
      el('div', { className: 'notia-gb-form__actions' }, [add, this.doneButton()]),
    ]))
  }
}

export class DrawingView extends GitbookAtomView {
  private altField: HTMLInputElement | HTMLTextAreaElement | null = null

  constructor(node: ProseMirrorNode, view: EditorView, getPos: GetPos, env: GitbookViewEnvironment) {
    super(node, view, getPos, env, 'notia-gb-drawing')
    this.render()
  }

  render(): void {
    const src = this.attr('src')
    const image = imageSource(this.env, src)
    if (this.altField && document.activeElement === this.altField) return
    this.altField = field(this.attr('alt'), { label: 'Descripción del dibujo', placeholder: 'Descripción del dibujo' }, (alt) => this.setAttrs({ alt }))
    const editable = !src || src.startsWith('data:image/svg+xml')
    this.dom.replaceChildren(...present<Node>([
      image
        ? el('img', { className: 'notia-gb-drawing__image', attrs: { src: image, alt: this.attr('alt') } })
        : el('div', { className: 'notia-gb-drawing__empty' }, [iconSpan('notia-drawing', 'notia-gb-icon', 28), el('span', { text: src ? 'No se encontró el dibujo' : 'Dibujo vacío' })]),
      this.attr('caption') ? el('p', { className: 'notia-gb-atom__detail', text: this.attr('caption') }) : null,
      controls('notia-gb-drawing__actions', [
        this.altField,
        editable ? textButton(src ? 'Editar dibujo' : 'Dibujar', () => void this.draw(), { icon: 'notia-drawing', className: 'notia-gb-primary' }) : null,
      ]),
    ]))
  }

  private async draw(): Promise<void> {
    const next = await this.env.editDrawing(this.attr('src'))
    if (next !== null) this.setAttrs({ src: next })
  }
}

// ---------- Inline elements ----------

abstract class GitbookInlineView extends GitbookAtomView {
  constructor(node: ProseMirrorNode, view: EditorView, getPos: GetPos, env: GitbookViewEnvironment, className: string) {
    super(node, view, getPos, env, className, 'span')
    this.dom.setAttribute('role', 'button')
    this.dom.tabIndex = -1
    this.dom.addEventListener('click', (event) => {
      event.preventDefault()
      this.openEditor()
    })
  }

  stopEvent(event: Event): boolean {
    // The press selects the element; the click opens its fields.
    return event.type === 'click'
  }

  protected abstract editorFields(close: () => void): Array<Node | null>

  private openEditor(): void {
    openPopover(this.dom, (close) => controls('notia-gb-form notia-gb-inline-form', [
      ...this.editorFields(close),
      el('div', { className: 'notia-gb-form__actions' }, [textButton('Listo', close, { className: 'notia-gb-primary' })]),
    ]))
  }

  protected row(label: string, input: HTMLElement): HTMLElement {
    return el('label', { className: 'notia-gb-form__row' }, [el('span', { text: label }), input])
  }
}

export class ButtonView extends GitbookInlineView {
  constructor(node: ProseMirrorNode, view: EditorView, getPos: GetPos, env: GitbookViewEnvironment) {
    super(node, view, getPos, env, 'notia-gb-link-button')
    this.render()
  }

  render(): void {
    this.dom.dataset.variant = this.attr('variant') === 'secondary' ? 'secondary' : 'primary'
    this.dom.replaceChildren(...present<Node>([
      this.attr('icon') ? iconSpan(this.attr('icon'), 'notia-gb-icon', 14) : null,
      el('span', { text: this.attr('label') || 'Botón' }),
    ]))
    this.dom.title = this.attr('href')
  }

  protected editorFields(close: () => void) {
    const href = this.attr('href')
    return [
      this.row('Texto', field(this.attr('label'), { label: 'Texto del botón' }, (label) => this.setAttrs({ label }))),
      this.row('Enlace', field(href, { label: 'Enlace del botón', placeholder: 'https://… o nota.md' }, (value) => this.setAttrs({ href: value.trim() }))),
      this.row('Estilo', select(this.attr('variant') || 'primary', 'Estilo del botón', BUTTON_VARIANTS.map((variant) => [variant, variant === 'primary' ? 'Principal' : 'Secundario']), (variant) => this.setAttrs({ variant }))),
      this.row('Ícono', field(this.attr('icon'), { label: 'Ícono del botón', placeholder: 'Por ejemplo, rocket' }, (icon) => this.setAttrs({ icon: icon.trim().replace(/^fa-/, '') }))),
      href ? textButton('Abrir enlace', () => {
        close()
        openReference(this.env, href)
      }, { icon: 'notia-open' }) : null,
    ]
  }
}

export class IconView extends GitbookInlineView {
  constructor(node: ProseMirrorNode, view: EditorView, getPos: GetPos, env: GitbookViewEnvironment) {
    super(node, view, getPos, env, 'notia-gb-inline-icon')
    this.render()
  }

  render(): void {
    this.dom.innerHTML = iconMarkup(this.attr('name') || 'circle', 16)
    this.dom.setAttribute('aria-label', `Ícono ${this.attr('name')}`)
    this.dom.title = this.attr('name')
  }

  protected editorFields() {
    return [this.row('Ícono', field(this.attr('name'), { label: 'Nombre del ícono', placeholder: 'Por ejemplo, check' }, (name) => {
      const clean = name.trim().replace(/^fa-/, '')
      this.setAttrs({ name: clean, label: clean })
    }))]
  }
}

export class ExpressionView extends GitbookInlineView {
  constructor(node: ProseMirrorNode, view: EditorView, getPos: GetPos, env: GitbookViewEnvironment) {
    super(node, view, getPos, env, 'notia-gb-expression')
    this.render()
  }

  render(): void {
    const expression = this.attr('expression').trim()
    const result = expression ? this.env.resolver.get('expression', expression) : undefined
    const value = result?.value ?? null
    this.dom.dataset.state = !expression || result?.error ? 'invalid' : value === null ? 'empty' : 'value'
    this.dom.textContent = value ?? (result?.dependsOnReader ? 'Según el lector' : expression || 'Variable')
    this.dom.title = result?.error ? `${expression}: ${result.error}` : expression
  }

  protected editorFields() {
    const expression = this.attr('expression')
    const result = expression.trim() ? this.env.resolver.get('expression', expression.trim()) : undefined
    return [
      this.row('Expresión', field(expression, { label: 'Expresión', placeholder: 'page.vars.version', className: 'notia-gb-mono' }, (value) => this.setAttrs({ expression: value.trim() }))),
      el('p', { className: 'notia-gb-muted', text: result?.error ?? 'Variables: page.vars (propiedad «vars» de la nota) y space.vars (.gitbook/vars.yaml).' }),
    ]
  }
}

export class InlineImageView extends GitbookInlineView {
  constructor(node: ProseMirrorNode, view: EditorView, getPos: GetPos, env: GitbookViewEnvironment) {
    super(node, view, getPos, env, 'notia-gb-inline-image')
    this.render()
  }

  render(): void {
    const source = imageSource(this.env, this.attr('src'))
    this.dom.replaceChildren(source
      ? el('img', { attrs: { src: source, alt: this.attr('alt') } })
      : iconSpan('image', 'notia-gb-icon', 14))
    this.dom.title = this.attr('alt') || this.attr('src')
  }

  protected editorFields() {
    return [
      this.row('Imagen', field(this.attr('src'), { label: 'Imagen', placeholder: 'Ruta o dirección de la imagen' }, (src) => this.setAttrs({ src: src.trim() }))),
      this.row('Descripción', field(this.attr('alt'), { label: 'Descripción de la imagen' }, (alt) => this.setAttrs({ alt }))),
    ]
  }
}
