import { loadDrawioRuntime } from '../engines/drawioRuntimeLoader'
import type { DrawioDocumentDescriptor } from '../types'

interface DrawioUi {
  actions?: {
    get?: (actionName: string) => {
      funct?: () => void
    } | null | undefined
  }
  diagramContainer?: HTMLElement | null
  editor?: {
    graph?: {
      container?: HTMLElement | null
      sizeDidChange?: () => void
      view?: {
        validateBackground?: () => void
      }
    }
  }
  fileLoaded: (file: unknown, noDialogs?: boolean) => boolean | void
  fileLoadedError?: unknown
  getCurrentFile: () => {
    isModified?: () => boolean
    save?: (
      revision: boolean,
      success?: () => void,
      error?: (error: unknown) => void,
      unloading?: boolean,
      overwrite?: boolean,
      manual?: boolean,
    ) => void
  } | null
  hideDialog?: () => void
  refresh?: () => void
  resetScrollbars?: () => void
  setDarkMode?: (enabled: boolean) => void
  windowResized?: () => void
}

function normalizeDrawioError(error: unknown): Error {
  if (error instanceof Error) {
    return error
  }

  if (typeof error === 'string' && error.trim()) {
    return new Error(error)
  }

  return new Error('No se pudo completar la operacion de draw.io.')
}

class DrawioEditorManager {
  private ui: DrawioUi | null = null
  private rootElement: HTMLDivElement | null = null
  private currentDocumentPath: string | null = null
  private initialViewportPath: string | null = null
  private operationQueue: Promise<void> = Promise.resolve()
  private themeObserver: MutationObserver | null = null
  private viewportObserver: ResizeObserver | null = null
  private viewportRefreshFrameId: number | null = null

  private cancelViewportRefresh(): void {
    if (this.viewportRefreshFrameId === null) {
      return
    }

    window.cancelAnimationFrame(this.viewportRefreshFrameId)
    this.viewportRefreshFrameId = null
  }

  private disconnectViewportObserver(): void {
    this.viewportObserver?.disconnect()
    this.viewportObserver = null
  }

  private disconnectThemeObserver(): void {
    this.themeObserver?.disconnect()
    this.themeObserver = null
  }

  private ensureRootShellClasses(rootElement: HTMLDivElement): void {
    rootElement.classList.add('notia-drawio-runtime-root', 'geEditor', 'geClassic')
  }

  private getViewportElements(ui: DrawioUi): HTMLElement[] {
    const elements = [
      ui.editor?.graph?.container ?? null,
      ui.diagramContainer ?? null,
      this.rootElement,
    ]

    return elements.filter((element): element is HTMLElement => element instanceof HTMLElement)
  }

  private resolveThemeHost(mountElement: HTMLElement): HTMLElement {
    const themedHost = mountElement.closest('.notia-app-shell')
    return themedHost instanceof HTMLElement ? themedHost : document.documentElement
  }

  private isDarkTheme(hostElement: HTMLElement): boolean {
    if (hostElement.classList.contains('notia-theme-light')) {
      return false
    }

    if (hostElement.classList.contains('notia-theme-dark')) {
      return true
    }

    return getComputedStyle(hostElement).colorScheme.includes('dark')
  }

  private syncDrawioTheme(ui: DrawioUi, mountElement: HTMLElement): void {
    const hostElement = this.resolveThemeHost(mountElement)
    const isDarkThemeEnabled = this.isDarkTheme(hostElement)

    ui.setDarkMode?.(isDarkThemeEnabled)
    this.rootElement?.style.setProperty('color-scheme', isDarkThemeEnabled ? 'dark' : 'light')
    ui.windowResized?.()
    ui.refresh?.()
    ui.editor?.graph?.view?.validateBackground?.()
    ui.editor?.graph?.sizeDidChange?.()
  }

  private registerThemeObserver(mountElement: HTMLElement, ui: DrawioUi): void {
    this.disconnectThemeObserver()
    this.syncDrawioTheme(ui, mountElement)

    if (typeof MutationObserver === 'undefined') {
      return
    }

    const hostElement = this.resolveThemeHost(mountElement)
    const observer = new MutationObserver(() => {
      this.syncDrawioTheme(ui, mountElement)
    })

    observer.observe(hostElement, {
      attributeFilter: ['class', 'style'],
      attributes: true,
    })

    this.themeObserver = observer
  }

  private hasUsableViewport(ui: DrawioUi): boolean {
    const primaryViewportElements = [
      ui.editor?.graph?.container ?? null,
      ui.diagramContainer ?? null,
    ].filter((element): element is HTMLElement => element instanceof HTMLElement)

    if (primaryViewportElements.length > 0) {
      return primaryViewportElements.some((element) => (
        element.clientWidth > 0 && element.clientHeight > 0
      ))
    }

    return this.rootElement instanceof HTMLElement
      && this.rootElement.clientWidth > 0
      && this.rootElement.clientHeight > 0
  }

  private registerViewportObserver(mountElement: HTMLElement, ui: DrawioUi): void {
    this.disconnectViewportObserver()

    if (typeof ResizeObserver === 'undefined') {
      return
    }

    const observer = new ResizeObserver(() => {
      const shouldResetViewport = this.initialViewportPath !== null
        && this.currentDocumentPath === this.initialViewportPath

      this.scheduleViewportRefresh(
        shouldResetViewport
          ? { resetViewport: true }
          : undefined,
      )
    })

    observer.observe(mountElement)

    for (const element of this.getViewportElements(ui)) {
      if (element !== mountElement) {
        observer.observe(element)
      }
    }

    this.viewportObserver = observer
  }

  private async ensureUi(mountElement: HTMLElement): Promise<DrawioUi> {
    if (this.ui && this.rootElement) {
      this.ensureRootShellClasses(this.rootElement)

      if (this.rootElement.parentElement !== mountElement) {
        mountElement.appendChild(this.rootElement)
      }

      this.scheduleViewportRefresh()
      return this.ui
    }

    const runtime = await loadDrawioRuntime()
    const rootElement = document.createElement('div')
    this.ensureRootShellClasses(rootElement)
    mountElement.appendChild(rootElement)

    const ui = await runtime.createUi(rootElement)
    this.ui = ui
    this.rootElement = rootElement
    this.scheduleViewportRefresh()
    return ui
  }

  private enqueueOperation<T>(operation: () => Promise<T>): Promise<T> {
    const nextOperation = this.operationQueue.then(operation, operation)
    this.operationQueue = nextOperation.then(() => undefined, () => undefined)
    return nextOperation
  }

  private scheduleViewportRefresh(options?: { resetViewport?: boolean }): void {
    if (!this.ui) {
      return
    }

    this.cancelViewportRefresh()

    const runRefresh = (attempt: number) => {
      const ui = this.ui
      if (!ui) {
        this.viewportRefreshFrameId = null
        return
      }

      if (!this.hasUsableViewport(ui) && attempt < 120) {
        this.viewportRefreshFrameId = window.requestAnimationFrame(() => {
          runRefresh(attempt + 1)
        })
        return
      }

      this.viewportRefreshFrameId = null
      ui.windowResized?.()
      ui.refresh?.()
      ui.editor?.graph?.view?.validateBackground?.()
      ui.editor?.graph?.sizeDidChange?.()

      if (!options?.resetViewport) {
        return
      }

      window.requestAnimationFrame(() => {
        const currentUi = this.ui
        if (!currentUi) {
          return
        }

        currentUi.actions?.get?.('resetView')?.funct?.()
        currentUi.resetScrollbars?.()
        currentUi.windowResized?.()
        currentUi.editor?.graph?.view?.validateBackground?.()
        currentUi.editor?.graph?.sizeDidChange?.()

        if (this.initialViewportPath === this.currentDocumentPath) {
          this.initialViewportPath = null
        }
      })
    }

    this.viewportRefreshFrameId = window.requestAnimationFrame(() => {
      runRefresh(0)
    })
  }

  private async flushCurrentInternal(): Promise<void> {
    if (!this.ui) {
      return
    }

    const currentFile = this.ui.getCurrentFile()
    if (!currentFile?.isModified?.() || !currentFile.save) {
      return
    }

    await new Promise<void>((resolve, reject) => {
      currentFile.save?.(true, resolve, (error) => reject(normalizeDrawioError(error)))
    })
  }

  private async attachInternal(mountElement: HTMLElement, descriptor: DrawioDocumentDescriptor): Promise<void> {
    const ui = await this.ensureUi(mountElement)
    this.registerThemeObserver(mountElement, ui)
    this.registerViewportObserver(mountElement, ui)
    ui.hideDialog?.()

    if (this.currentDocumentPath === descriptor.path) {
      this.scheduleViewportRefresh()
      return
    }

    if (this.currentDocumentPath) {
      await this.flushCurrentInternal()
    }

    const runtime = await loadDrawioRuntime()
    const opened = ui.fileLoaded(runtime.createFile(ui as never, descriptor), true)

    if (opened === false || !ui.getCurrentFile()) {
      throw normalizeDrawioError(ui.fileLoadedError)
    }

    this.currentDocumentPath = descriptor.path
    this.initialViewportPath = descriptor.path
    this.scheduleViewportRefresh({ resetViewport: true })
  }

  private async detachInternal(path: string, options?: { flush?: boolean }): Promise<void> {
    if (this.currentDocumentPath !== path || !this.rootElement) {
      return
    }

    if (options?.flush) {
      await this.flushCurrentInternal()
    }

    if (this.rootElement.parentElement) {
      this.rootElement.parentElement.removeChild(this.rootElement)
    }

    this.currentDocumentPath = null
    this.initialViewportPath = null
    this.cancelViewportRefresh()
    this.disconnectThemeObserver()
    this.disconnectViewportObserver()
  }

  attach(mountElement: HTMLElement, descriptor: DrawioDocumentDescriptor): Promise<void> {
    return this.enqueueOperation(() => this.attachInternal(mountElement, descriptor))
  }

  detach(path: string, options?: { flush?: boolean }): Promise<void> {
    return this.enqueueOperation(() => this.detachInternal(path, options))
  }

  flush(path: string): Promise<void> {
    return this.enqueueOperation(async () => {
      if (this.currentDocumentPath !== path) {
        return
      }

      await this.flushCurrentInternal()
    })
  }
}

let manager: DrawioEditorManager | null = null

export function getDrawioEditorManager(): DrawioEditorManager {
  if (!manager) {
    manager = new DrawioEditorManager()
  }

  return manager
}
