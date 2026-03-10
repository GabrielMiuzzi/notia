// @ts-nocheck
export interface InkdocHostBridge {
  rootPath: string
  getActiveFilePath: () => string | null
  listFilePaths: () => string[]
  readFile: (absolutePath: string) => Promise<string>
  writeFile: (absolutePath: string, content: string) => Promise<void>
  createFile: (absolutePath: string, content: string) => Promise<void>
  createFolder: (absolutePath: string) => Promise<void>
  deletePath: (absolutePath: string) => Promise<void>
  existsPath: (absolutePath: string) => Promise<boolean>
  writeBinaryFile: (absolutePath: string, data: Uint8Array) => Promise<void>
  onOpenFile: (absolutePath: string) => Promise<void> | void
}

type EventHandler = (...args: unknown[]) => void

const globalKey = '__notiaInkdocPlatformInitialized__'

function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, '/')
}

function isAbsolutePath(value: string): boolean {
  const normalized = normalizeSlashes(value)
  return (
    normalized.startsWith('/')
    || /^[a-zA-Z]:\//.test(normalized)
    || /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(normalized)
  )
}

function normalizeSegments(value: string): string {
  const source = normalizeSlashes(value)
  const uriPrefixMatch = source.match(/^([a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/]*)(\/.*)?$/)
  if (uriPrefixMatch) {
    const uriPrefix = uriPrefixMatch[1]
    const uriPath = (uriPrefixMatch[2] ?? '').replace(/^\/+/, '')
    const segments = uriPath.split('/').filter((segment) => segment.length > 0)
    const normalized: string[] = []

    for (const segment of segments) {
      if (segment === '.') {
        continue
      }
      if (segment === '..') {
        if (normalized.length > 0) {
          normalized.pop()
        }
        continue
      }
      normalized.push(segment)
    }

    return normalized.length > 0 ? `${uriPrefix}/${normalized.join('/')}` : `${uriPrefix}/`
  }

  const prefixMatch = source.match(/^[a-zA-Z]:\//)
  const prefix = prefixMatch ? prefixMatch[0] : source.startsWith('/') ? '/' : ''
  const raw = prefix ? source.slice(prefix.length) : source
  const segments = raw.split('/').filter((segment) => segment.length > 0)
  const normalized: string[] = []

  for (const segment of segments) {
    if (segment === '.') {
      continue
    }
    if (segment === '..') {
      if (normalized.length > 0) {
        normalized.pop()
      }
      continue
    }
    normalized.push(segment)
  }

  return `${prefix}${normalized.join('/')}`
}

function joinPaths(base: string, value: string): string {
  if (!base) {
    return normalizeSegments(value)
  }

  const normalizedBase = normalizeSlashes(base).replace(/\/+$/, '')
  const normalizedValue = normalizeSlashes(value).replace(/^\/+/, '')
  return normalizeSegments(`${normalizedBase}/${normalizedValue}`)
}

function dirnameOf(value: string): string {
  const normalized = normalizeSegments(value)
  const index = normalized.lastIndexOf('/')
  if (index < 0) {
    return ''
  }
  if (index === 0) {
    return '/'
  }
  return normalized.slice(0, index)
}

function basenameOf(value: string): string {
  const normalized = normalizeSegments(value).replace(/\/+$/, '')
  const index = normalized.lastIndexOf('/')
  return index < 0 ? normalized : normalized.slice(index + 1)
}

function extensionOf(value: string): string {
  const base = basenameOf(value)
  const dotIndex = base.lastIndexOf('.')
  return dotIndex <= 0 ? '' : base.slice(dotIndex)
}

function normalizePathValue(value: string): string {
  return normalizeSegments(value)
}

function resolveFromRoot(rootPath: string, value: string): string {
  if (!value) {
    return normalizePathValue(rootPath)
  }

  if (isAbsolutePath(value)) {
    return normalizePathValue(value)
  }

  return normalizePathValue(joinPaths(rootPath, value))
}

function resolveRelativePath(fromFilePath: string, targetPath: string): string {
  const sourceDir = dirnameOf(fromFilePath)
  return normalizePathValue(joinPaths(sourceDir, targetPath))
}

function installDomHelpers(): void {
  const globalScope = globalThis as Record<string, unknown>
  if (globalScope[globalKey]) {
    return
  }

  const elementPrototype = Element.prototype as Element & Record<string, unknown>

  if (!('empty' in elementPrototype)) {
    Object.defineProperty(Element.prototype, 'empty', {
      value(this: Element) {
        while (this.firstChild) {
          this.removeChild(this.firstChild)
        }
      },
    })
  }

  if (!('addClass' in elementPrototype)) {
    Object.defineProperty(Element.prototype, 'addClass', {
      value(this: Element, ...classNames: string[]) {
        this.classList.add(...classNames.filter(Boolean))
      },
    })
  }

  if (!('removeClass' in elementPrototype)) {
    Object.defineProperty(Element.prototype, 'removeClass', {
      value(this: Element, ...classNames: string[]) {
        this.classList.remove(...classNames.filter(Boolean))
      },
    })
  }

  if (!('toggleClass' in elementPrototype)) {
    Object.defineProperty(Element.prototype, 'toggleClass', {
      value(this: Element, className: string, force?: boolean) {
        if (typeof force === 'boolean') {
          this.classList.toggle(className, force)
          return
        }
        this.classList.toggle(className)
      },
    })
  }

  if (!('setText' in elementPrototype)) {
    Object.defineProperty(Element.prototype, 'setText', {
      value(this: Element, text: string) {
        this.textContent = text
      },
    })
  }

  if (!('setAttr' in elementPrototype)) {
    Object.defineProperty(Element.prototype, 'setAttr', {
      value(this: Element, key: string, value: string) {
        this.setAttribute(key, value)
      },
    })
  }

  const createElement = function<K extends keyof HTMLElementTagNameMap>(
    this: Element,
    tag: K,
    options?: {
      cls?: string
      text?: string
      attr?: Record<string, string>
      type?: string
    },
  ): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag)
    if (options?.cls) {
      node.className = options.cls
    }
    if (typeof options?.text === 'string') {
      node.textContent = options.text
    }
    if (options?.attr) {
      for (const [key, value] of Object.entries(options.attr)) {
        node.setAttribute(key, value)
      }
    }
    if (options?.type && node instanceof HTMLInputElement) {
      node.type = options.type
    }
    this.appendChild(node)
    return node
  }

  if (!('createEl' in elementPrototype)) {
    Object.defineProperty(Element.prototype, 'createEl', {
      value: createElement,
    })
  }

  if (!('createDiv' in elementPrototype)) {
    Object.defineProperty(Element.prototype, 'createDiv', {
      value(this: Element, options?: { cls?: string; text?: string; attr?: Record<string, string> }) {
        return createElement.call(this, 'div', options)
      },
    })
  }

  if (!('createSpan' in elementPrototype)) {
    Object.defineProperty(Element.prototype, 'createSpan', {
      value(this: Element, options?: { cls?: string; text?: string; attr?: Record<string, string> }) {
        return createElement.call(this, 'span', options)
      },
    })
  }

  globalScope[globalKey] = true
}

class EventBus {
  private readonly handlers = new Map<string, Set<EventHandler>>()

  on(event: string, handler: EventHandler): () => void {
    const current = this.handlers.get(event) ?? new Set<EventHandler>()
    current.add(handler)
    this.handlers.set(event, current)

    return () => {
      const entries = this.handlers.get(event)
      entries?.delete(handler)
      if (entries && entries.size === 0) {
        this.handlers.delete(event)
      }
    }
  }

  emit(event: string, ...args: unknown[]): void {
    const entries = this.handlers.get(event)
    if (!entries) {
      return
    }

    for (const handler of entries) {
      handler(...args)
    }
  }
}

export class TAbstractFile {
  path: string
  name: string

  constructor(path: string) {
    this.path = normalizePathValue(path)
    this.name = basenameOf(path)
  }
}

export class TFolder extends TAbstractFile {}

export class TFile extends TAbstractFile {
  extension: string
  parent: TFolder | null

  constructor(path: string) {
    super(path)
    this.extension = extensionOf(path).replace(/^\./, '').toLowerCase()
    const parentPath = normalizePathValue(dirnameOf(path))
    this.parent = parentPath === this.path ? null : new TFolder(parentPath)
  }
}

class VaultAdapter {
  constructor(private readonly bridge: InkdocHostBridge) {}

  async exists(path: string): Promise<boolean> {
    return this.bridge.existsPath(resolveFromRoot(this.bridge.rootPath, path))
  }

  async mkdir(path: string): Promise<void> {
    await this.bridge.createFolder(resolveFromRoot(this.bridge.rootPath, path))
  }

  async writeBinary(path: string, data: ArrayBuffer | Uint8Array): Promise<void> {
    const asUint8 = data instanceof Uint8Array ? data : new Uint8Array(data)
    await this.bridge.writeBinaryFile(resolveFromRoot(this.bridge.rootPath, path), asUint8)
  }
}

class Vault {
  readonly adapter: VaultAdapter
  private readonly eventBus = new EventBus()

  constructor(private readonly bridge: InkdocHostBridge) {
    this.adapter = new VaultAdapter(bridge)
  }

  on(event: 'modify', handler: (file: TFile) => void): () => void {
    return this.eventBus.on(event, handler as EventHandler)
  }

  async read(file: TFile): Promise<string> {
    return this.bridge.readFile(file.path)
  }

  async modify(file: TFile, content: string): Promise<void> {
    await this.bridge.writeFile(file.path, content)
    this.eventBus.emit('modify', file)
  }

  async create(filePath: string, content: string): Promise<TFile> {
    const resolvedPath = resolveFromRoot(this.bridge.rootPath, filePath)
    await this.bridge.createFile(resolvedPath, content)
    const file = new TFile(resolvedPath)
    this.eventBus.emit('modify', file)
    return file
  }

  async createFolder(folderPath: string): Promise<void> {
    await this.bridge.createFolder(resolveFromRoot(this.bridge.rootPath, folderPath))
  }

  async delete(file: TAbstractFile): Promise<void> {
    await this.bridge.deletePath(file.path)
  }

  getRoot(): TFolder {
    return new TFolder(this.bridge.rootPath)
  }

  getFiles(): TFile[] {
    return this.bridge.listFilePaths().map((filePath) => new TFile(filePath))
  }

  getAbstractFileByPath(path: string): TAbstractFile | null {
    const resolvedPath = resolveFromRoot(this.bridge.rootPath, path)
    if (this.bridge.listFilePaths().includes(resolvedPath)) {
      return new TFile(resolvedPath)
    }

    const hasFileInside = this.bridge
      .listFilePaths()
      .some((filePath) => filePath.startsWith(`${resolvedPath}/`) || filePath === resolvedPath)

    if (hasFileInside || resolvedPath === normalizePathValue(this.bridge.rootPath)) {
      return new TFolder(resolvedPath)
    }

    return null
  }
}

class MetadataCache {
  resolvedLinks: Record<string, Record<string, number>> = {}
  unresolvedLinks: Record<string, Record<string, number>> = {}
  private readonly eventBus = new EventBus()

  constructor(private readonly bridge: InkdocHostBridge) {}

  getFirstLinkpathDest(linkPath: string, sourcePath: string): TFile | null {
    const decoded = decodeURIComponent(linkPath).replace(/^#/, '').trim()
    if (!decoded) {
      return null
    }

    const normalizedTarget = normalizePath(decoded.split('#')[0] ?? '')
    const candidates = new Set<string>()

    if (isAbsolutePath(normalizedTarget)) {
      candidates.add(normalizePathValue(normalizedTarget))
    } else {
      candidates.add(resolveRelativePath(sourcePath, normalizedTarget))
      candidates.add(resolveFromRoot(this.bridge.rootPath, normalizedTarget))
    }

    const hasExtension = /\.[a-z0-9]+$/i.test(normalizedTarget)
    if (!hasExtension) {
      for (const suffix of ['.md', '.inkdoc']) {
        if (isAbsolutePath(normalizedTarget)) {
          candidates.add(normalizePathValue(`${normalizedTarget}${suffix}`))
        } else {
          candidates.add(resolveRelativePath(sourcePath, `${normalizedTarget}${suffix}`))
          candidates.add(resolveFromRoot(this.bridge.rootPath, `${normalizedTarget}${suffix}`))
        }
      }
    }

    const files = this.bridge.listFilePaths()
    for (const candidate of candidates) {
      if (files.includes(candidate)) {
        return new TFile(candidate)
      }
    }

    return null
  }

  trigger(event: string, file?: TFile): void {
    this.eventBus.emit(event, file)
  }
}

export class WorkspaceLeaf {
  view: unknown = null

  constructor(private readonly appRef: App, private readonly bridge: InkdocHostBridge) {}

  get app(): App {
    return this.appRef
  }

  async openFile(file: TFile): Promise<void> {
    await this.bridge.onOpenFile(file.path)
  }
}

class Workspace {
  constructor(private readonly appRef: App, private readonly bridge: InkdocHostBridge) {}

  getLeaf(_newLeaf?: boolean): WorkspaceLeaf {
    return new WorkspaceLeaf(this.appRef, this.bridge)
  }

  getActiveFile(): TFile | null {
    const activePath = this.bridge.getActiveFilePath()
    return activePath ? new TFile(activePath) : null
  }

  detachLeavesOfType(_viewType: string): void {
    // no-op
  }

  getLeavesOfType(_viewType: string): WorkspaceLeaf[] {
    return []
  }
}

export class App {
  readonly vault: Vault
  readonly workspace: Workspace
  readonly metadataCache: MetadataCache

  constructor(private readonly bridge: InkdocHostBridge) {
    installDomHelpers()
    this.vault = new Vault(bridge)
    this.workspace = new Workspace(this, bridge)
    this.metadataCache = new MetadataCache(bridge)
  }
}

export class ItemView {
  protected readonly app: App
  protected readonly leaf: WorkspaceLeaf
  protected readonly contentEl: HTMLDivElement
  protected readonly containerEl: HTMLDivElement
  private readonly cleanups: Array<() => void> = []

  constructor(leaf: WorkspaceLeaf) {
    this.leaf = leaf
    this.app = leaf.app
    this.containerEl = document.createElement('div')
    this.contentEl = this.containerEl
  }

  registerEvent(ref: (() => void) | { off: () => void }): void {
    if (typeof ref === 'function') {
      this.cleanups.push(ref)
      return
    }

    this.cleanups.push(() => ref.off())
  }

  registerDomEvent<K extends keyof WindowEventMap>(
    target: Window,
    eventName: K,
    listener: (event: WindowEventMap[K]) => void,
    options?: boolean | AddEventListenerOptions,
  ): void
  registerDomEvent<K extends keyof HTMLElementEventMap>(
    target: HTMLElement,
    eventName: K,
    listener: (event: HTMLElementEventMap[K]) => void,
    options?: boolean | AddEventListenerOptions,
  ): void
  registerDomEvent(
    target: Window | HTMLElement,
    eventName: string,
    listener: EventListener,
    options?: boolean | AddEventListenerOptions,
  ): void {
    target.addEventListener(eventName, listener, options)
    this.cleanups.push(() => target.removeEventListener(eventName, listener, options))
  }

  async onOpen(): Promise<void> {
    // no-op
  }

  async onClose(): Promise<void> {
    while (this.cleanups.length > 0) {
      const cleanup = this.cleanups.pop()
      cleanup?.()
    }
  }
}

export class Modal {
  protected readonly app: App
  protected readonly modalEl: HTMLDivElement
  protected readonly titleEl: HTMLHeadingElement
  protected readonly contentEl: HTMLDivElement

  constructor(app: App) {
    installDomHelpers()
    this.app = app
    this.modalEl = document.createElement('div')
    this.modalEl.className = 'modal mod-sidebar-layout modal-container'
    this.modalEl.style.position = 'fixed'
    this.modalEl.style.inset = '0'
    this.modalEl.style.zIndex = '20000'
    this.titleEl = document.createElement('h2')
    this.contentEl = document.createElement('div')
    this.contentEl.className = 'modal-content'
  }

  onOpen(): void {
    // no-op
  }

  onClose(): void {
    // no-op
  }

  open(): void {
    this.modalEl.empty()
    const body = document.createElement('div')
    body.className = 'modal-bg'
    const inner = document.createElement('div')
    inner.className = 'modal'
    inner.appendChild(this.titleEl)
    inner.appendChild(this.contentEl)
    this.modalEl.appendChild(body)
    this.modalEl.appendChild(inner)
    document.body.appendChild(this.modalEl)
    window.setTimeout(() => {
      body.addEventListener('click', () => this.close(), { once: true })
    }, 0)
    this.onOpen()
  }

  close(): void {
    this.onClose()
    this.modalEl.remove()
  }
}

class MenuItem {
  private title = ''
  private icon = ''
  private handler: (() => void) | null = null

  setTitle(value: string): this {
    this.title = value
    return this
  }

  setIcon(value: string): this {
    this.icon = value
    return this
  }

  onClick(handler: () => void): this {
    this.handler = handler
    return this
  }

  render(close: () => void): HTMLButtonElement {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'menu-item'
    button.textContent = this.title
    if (this.icon) {
      button.dataset.icon = this.icon
    }
    button.addEventListener('click', () => {
      this.handler?.()
      close()
    })
    return button
  }
}

export class Menu {
  private readonly items: MenuItem[] = []

  addItem(builder: (item: MenuItem) => void): this {
    const item = new MenuItem()
    builder(item)
    this.items.push(item)
    return this
  }

  showAtPosition(position: { x: number; y: number }): void {
    const root = document.createElement('div')
    root.className = 'menu inkdoc-compat-menu'
    root.style.position = 'fixed'
    root.style.zIndex = '20010'
    root.style.left = `${position.x}px`
    root.style.top = `${position.y}px`
    root.style.minWidth = '180px'
    root.style.padding = '6px'
    root.style.borderRadius = '8px'
    root.style.background = '#1f2937'
    root.style.color = '#f9fafb'
    const close = () => {
      root.remove()
      window.removeEventListener('pointerdown', onPointerDown)
    }

    for (const item of this.items) {
      root.appendChild(item.render(close))
    }

    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || root.contains(event.target)) {
        return
      }
      close()
    }

    document.body.appendChild(root)
    window.addEventListener('pointerdown', onPointerDown)
  }
}

export class Notice {
  constructor(message: string, timeout = 2200) {
    const node = document.createElement('div')
    node.className = 'notice'
    node.textContent = message
    Object.assign(node.style, {
      position: 'fixed',
      right: '20px',
      bottom: '20px',
      zIndex: '10000',
      padding: '8px 12px',
      borderRadius: '8px',
      background: '#1f2937',
      color: '#f9fafb',
      fontSize: '13px',
    })
    document.body.appendChild(node)
    window.setTimeout(() => node.remove(), timeout)
  }
}

export const MarkdownRenderer = {
  async render(_app: App, source: string, container: HTMLElement): Promise<void> {
    container.empty()
    const trimmed = source.trim()
    const displayMathMatch = trimmed.match(/^\$\$([\s\S]*)\$\$$/)
    if (displayMathMatch) {
      try {
        const katexModule = await import('katex')
        const html = katexModule.renderToString(displayMathMatch[1]?.trim() ?? '', {
          throwOnError: false,
          displayMode: true,
        })
        const block = container.createDiv({ cls: 'inkdoc-markdown-render inkdoc-markdown-render--math' })
        block.innerHTML = html
        return
      } catch {
        // keep fallback
      }
    }

    const block = container.createDiv({ cls: 'inkdoc-markdown-render' })
    block.innerHTML = source
  },
}

export function normalizePath(value: string): string {
  return normalizeSegments(value)
}

export async function requestUrl(input: {
  url: string
  method?: string
  headers?: Record<string, string>
  body?: string | Uint8Array | ArrayBuffer
}): Promise<{ status: number; json: unknown; text: string; arrayBuffer: ArrayBuffer }> {
  const response = await fetch(input.url, {
    method: input.method,
    headers: input.headers,
    body:
      input.body instanceof Uint8Array
        ? input.body
        : input.body instanceof ArrayBuffer
          ? new Uint8Array(input.body)
          : input.body,
  })

  const text = await response.text()
  let json: unknown = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }

  return {
    status: response.status,
    json,
    text,
    arrayBuffer: new TextEncoder().encode(text).buffer,
  }
}

export function getIcon(_name: string): SVGSVGElement | null {
  return null
}

export function getIconIds(): string[] {
  return []
}

export function createInkdocApp(bridge: InkdocHostBridge): App {
  return new App(bridge)
}
