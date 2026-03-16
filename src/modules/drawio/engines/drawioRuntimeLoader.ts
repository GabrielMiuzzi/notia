import type { DrawioDocumentDescriptor } from '../types'

declare const __NOTIA_DRAWIO_RUNTIME_BASE__: string | undefined

interface DrawioAction {
  funct?: () => void
  setEnabled?: (enabled: boolean) => void
  visible?: boolean
}

interface DrawioExtendableConstructor {
  prototype: object
}

interface DrawioUi {
  actions?: {
    get?: (actionName: string) => DrawioAction | null | undefined
  }
  currentPage?: {
    getName?: () => string
  } | null
  diagramContainer?: HTMLElement | null
  editor?: {
    setAutosave?: (enabled: boolean) => void
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
  getCurrentFile: () => DrawioFileLike | null
  hideDialog?: () => void
  pages?: unknown[] | null
  refresh?: () => void
  resetScrollbars?: () => void
  setDarkMode?: (enabled: boolean) => void
  windowResized?: () => void
  hashValue: (value: string) => string
}

interface DrawioFileLike {
  isModified?: () => boolean
  save?: (
    revision: boolean,
    success?: () => void,
    error?: (error: unknown) => void,
    unloading?: boolean,
    overwrite?: boolean,
    manual?: boolean,
  ) => void
}

interface DrawioWindow extends Window {
  App: (new (...args: unknown[]) => unknown) & {
    MODE_DEVICE: string
    isMainCalled?: boolean
    main: (
      callback?: (ui: DrawioUi) => void,
      createUi?: () => unknown,
    ) => void
  }
  DrawioFile: (new (...args: unknown[]) => unknown) & {
    call: (self: unknown, ...args: unknown[]) => void
    prototype: {
      save: (
        revision: boolean,
        success?: () => void,
        error?: (error: unknown) => void,
        unloading?: boolean,
        overwrite?: boolean,
        manual?: boolean,
      ) => void
    }
  }
  Editor: new (...args: unknown[]) => unknown
  NotiaDrawioFile?: new (ui: DrawioUi, data: string, descriptor: DrawioDocumentBridge) => unknown
  mxUtils: {
    extend: (child: DrawioExtendableConstructor, parent: DrawioExtendableConstructor) => void
  }
  urlParams?: Record<string, string>
  DRAWIO_PUBLIC_BUILD?: boolean
  DRAWIO_BASE_URL?: string | null
  DRAWIO_SERVER_URL?: string
  DRAWIO_LIGHTBOX_URL?: string | null
  DRAWIO_VIEWER_URL?: string | null
  DRAWIO_CONFIG?: Record<string, unknown> | null
  EXPORT_URL?: string
  PLANT_URL?: string
  DRAW_MATH_URL?: string
  SHAPES_PATH?: string
  GRAPH_IMAGE_PATH?: string
  TEMPLATE_PATH?: string
  NEW_DIAGRAM_CATS_PATH?: string
  PLUGINS_BASE_PATH?: string
  RESOURCES_PATH?: string
  RESOURCE_BASE?: string
  STENCIL_PATH?: string
  IMAGE_PATH?: string
  STYLE_PATH?: string
  CSS_PATH?: string
  OPEN_FORM?: string
  mxBasePath?: string
  mxImageBasePath?: string
  mxLanguage?: string
  isLocalStorage?: boolean
  mxLoadSettings?: boolean
  mxLoadStylesheets?: boolean
  mxIsElectron?: boolean
  t0?: Date
  mxmeta?: (name: string | null, content: string, httpEquiv?: string) => void
  mxinclude?: (src: string) => void
  mxscript?: (
    src: string,
    onLoad?: (() => void) | null,
    id?: string | null,
    dataAppKey?: string | null,
    noWrite?: boolean | null,
    onError?: ((message: string, error: unknown) => void) | null,
  ) => void
}

interface DrawioDocumentBridge {
  path: string
  title: string
  persistSource: (nextSource: string) => Promise<void>
}

export interface DrawioRuntime {
  createUi: (container: HTMLElement) => Promise<DrawioUi>
  createFile: (ui: DrawioUi, descriptor: DrawioDocumentDescriptor) => unknown
}

const DRAWIO_STYLESHEET_IDS = {
  graphEditor: 'notia-drawio-grapheditor-css',
  mxgraphCommon: 'notia-drawio-mxgraph-common-css',
} as const
const DRAWIO_SCRIPT_QUEUE = [
  'js/PreConfig.js',
  'js/app.min.js',
  'js/PostConfig.js',
] as const
const DISABLED_ACTION_IDS = [
  'new',
  'open',
  'saveAs',
  'rename',
  'moveToFolder',
  'makeCopy',
  'openFolder',
  'synchronize',
  'share',
  'exit',
]
const DRAWIO_URL_PARAMS: Record<string, string> = {
  chrome: '1',
  db: '0',
  dev: '0',
  embed: '0',
  gapi: '0',
  gh: '0',
  gl: '0',
  local: '0',
  mode: 'device',
  noFileMenu: '0',
  od: '0',
  offline: '1',
  picker: '0',
  pwa: '0',
  plugins: '0',
  splash: '0',
  sync: 'manual',
  tr: '0',
}

let runtimePromise: Promise<DrawioRuntime> | null = null

function resolveDrawioRuntimeBasePath(): string {
  const runtimeBase = __NOTIA_DRAWIO_RUNTIME_BASE__
  if (typeof runtimeBase !== 'string') {
    return '/__notia_drawio__'
  }

  const normalizedRuntimeBase = runtimeBase.trim()
  return normalizedRuntimeBase.length > 0 ? normalizedRuntimeBase : '/__notia_drawio__'
}

function isAbsoluteAssetUrl(value: string): boolean {
  return /^(?:[a-z]+:)?\/\//i.test(value) || value.startsWith('data:') || value.startsWith('blob:')
}

function normalizeRuntimeAssetUrl(assetBasePath: string, value: string): string {
  if (isAbsoluteAssetUrl(value)) {
    return value
  }

  if (value.startsWith('/')) {
    return value
  }

  return `${assetBasePath}/${value.replace(/^\.?\//, '')}`
}

function loadStylesheetOnce(assetBasePath: string, stylesheetId: string, stylesheetPath: string): Promise<void> {
  const existing = document.getElementById(stylesheetId)
  if (existing) {
    return Promise.resolve()
  }

  return new Promise((resolve, reject) => {
    const link = document.createElement('link')
    link.id = stylesheetId
    link.rel = 'stylesheet'
    link.href = normalizeRuntimeAssetUrl(assetBasePath, stylesheetPath)
    link.onload = () => resolve()
    link.onerror = () => reject(new Error('No se pudo cargar la hoja de estilos de draw.io.'))
    document.head.appendChild(link)
  })
}

function loadScriptOnce(assetBasePath: string, scriptPath: string): Promise<void> {
  const scriptId = `notia-drawio-script-${scriptPath.replace(/[^a-z0-9]+/gi, '-')}`
  const existing = document.getElementById(scriptId)
  if (existing) {
    return Promise.resolve()
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.id = scriptId
    script.async = false
    script.defer = false
    script.src = normalizeRuntimeAssetUrl(assetBasePath, scriptPath)
    script.onload = () => resolve()
    script.onerror = () => reject(new Error(`No se pudo cargar ${scriptPath}.`))
    document.head.appendChild(script)
  })
}

function installScriptLoader(assetBasePath: string): void {
  const drawioWindow = window as unknown as DrawioWindow

  drawioWindow.mxmeta = drawioWindow.mxmeta ?? (() => {})
  drawioWindow.mxinclude = (src: string) => {
    void loadScriptOnce(assetBasePath, src)
  }
  drawioWindow.mxscript = (
    src: string,
    onLoad?: (() => void) | null,
    id?: string | null,
    _dataAppKey?: string | null,
    _noWrite?: boolean | null,
    onError?: ((message: string, error: unknown) => void) | null,
  ) => {
    void loadScriptOnce(assetBasePath, src)
      .then(() => {
        if (id) {
          const script = document.getElementById(`notia-drawio-script-${src.replace(/[^a-z0-9]+/gi, '-')}`)
          if (script) {
            script.id = id
          }
        }

        onLoad?.()
      })
      .catch((error) => {
        onError?.(`Failed to load ${src}`, error)
      })
  }
}

function configureRuntimeGlobals(assetBasePath: string): void {
  const drawioWindow = window as unknown as DrawioWindow

  drawioWindow.urlParams = {
    ...(drawioWindow.urlParams ?? {}),
    ...DRAWIO_URL_PARAMS,
  }
  drawioWindow.mxIsElectron = false
  drawioWindow.isLocalStorage = false
  drawioWindow.mxLoadSettings = false
  drawioWindow.mxLoadStylesheets = false
  drawioWindow.DRAWIO_PUBLIC_BUILD = true
  drawioWindow.DRAWIO_BASE_URL = assetBasePath
  drawioWindow.DRAWIO_SERVER_URL = `${assetBasePath}/`
  drawioWindow.DRAWIO_LIGHTBOX_URL = assetBasePath
  drawioWindow.DRAWIO_VIEWER_URL = normalizeRuntimeAssetUrl(assetBasePath, 'js/viewer.min.js')
  drawioWindow.EXPORT_URL = normalizeRuntimeAssetUrl(assetBasePath, 'export')
  drawioWindow.PLANT_URL = normalizeRuntimeAssetUrl(assetBasePath, 'plant')
  drawioWindow.DRAW_MATH_URL = normalizeRuntimeAssetUrl(assetBasePath, 'math4/es5')
  drawioWindow.SHAPES_PATH = normalizeRuntimeAssetUrl(assetBasePath, 'shapes')
  drawioWindow.GRAPH_IMAGE_PATH = normalizeRuntimeAssetUrl(assetBasePath, 'img')
  drawioWindow.TEMPLATE_PATH = normalizeRuntimeAssetUrl(assetBasePath, 'templates')
  drawioWindow.NEW_DIAGRAM_CATS_PATH = normalizeRuntimeAssetUrl(assetBasePath, 'newDiagramCats')
  drawioWindow.PLUGINS_BASE_PATH = assetBasePath
  drawioWindow.RESOURCES_PATH = normalizeRuntimeAssetUrl(assetBasePath, 'resources')
  drawioWindow.RESOURCE_BASE = normalizeRuntimeAssetUrl(assetBasePath, 'resources/dia')
  drawioWindow.STENCIL_PATH = normalizeRuntimeAssetUrl(assetBasePath, 'stencils')
  drawioWindow.IMAGE_PATH = normalizeRuntimeAssetUrl(assetBasePath, 'images')
  drawioWindow.STYLE_PATH = normalizeRuntimeAssetUrl(assetBasePath, 'styles')
  drawioWindow.CSS_PATH = normalizeRuntimeAssetUrl(assetBasePath, 'styles')
  drawioWindow.OPEN_FORM = normalizeRuntimeAssetUrl(assetBasePath, 'open.html')
  drawioWindow.mxBasePath = normalizeRuntimeAssetUrl(assetBasePath, 'mxgraph')
  drawioWindow.mxImageBasePath = normalizeRuntimeAssetUrl(assetBasePath, 'mxgraph/images')
  drawioWindow.t0 = drawioWindow.t0 ?? new Date()

  installScriptLoader(assetBasePath)
}

function applyUiGuards(ui: DrawioUi): void {
  ui.editor?.setAutosave?.(true)

  for (const actionId of DISABLED_ACTION_IDS) {
    const action = ui.actions?.get?.(actionId)
    action?.setEnabled?.(false)
    if (action) {
      action.visible = false
    }
  }
}

function normalizePersistError(error: unknown): Error {
  if (error instanceof Error) {
    return error
  }

  if (typeof error === 'string' && error.trim()) {
    return new Error(error)
  }

  return new Error('No se pudo guardar el archivo draw.io.')
}

function installNotiaDrawioFileConstructor(): void {
  const drawioWindow = window as unknown as DrawioWindow
  if (drawioWindow.NotiaDrawioFile) {
    return
  }

  function NotiaDrawioFile(this: {
    title: string
    path: string
    descriptor: string
    mode: string
    persistSource: (nextSource: string) => Promise<void>
    savingFile?: boolean
    setDescriptor: (descriptor: string) => void
    getDescriptor: () => string
    getData: () => string
    setModified: (value: boolean) => void
    setShadowModified: (value: boolean) => void
    addUnsavedStatus: (error: Error) => void
    fileSaved: (
      savedData: string,
      lastDescriptor: string,
      success?: () => void,
      error?: (error: unknown) => void,
    ) => void
  }, ui: DrawioUi, data: string, descriptor: DrawioDocumentBridge) {
    drawioWindow.DrawioFile.call(this, ui, data)
    this.title = descriptor.title
    this.path = descriptor.path
    this.persistSource = descriptor.persistSource
    this.descriptor = ui.hashValue(data)
    this.mode = drawioWindow.App.MODE_DEVICE
  }

  drawioWindow.mxUtils.extend(NotiaDrawioFile, drawioWindow.DrawioFile)

  NotiaDrawioFile.prototype.getHash = function(this: { path: string }) {
    return `N${encodeURIComponent(this.path)}`
  }

  NotiaDrawioFile.prototype.getMode = function(this: { mode: string }) {
    return this.mode
  }

  NotiaDrawioFile.prototype.getTitle = function(this: { title: string }) {
    return this.title
  }

  NotiaDrawioFile.prototype.isAutosaveOptional = function() {
    return true
  }

  NotiaDrawioFile.prototype.isRenamable = function() {
    return false
  }

  NotiaDrawioFile.prototype.getDescriptor = function(this: { descriptor: string }) {
    return this.descriptor
  }

  NotiaDrawioFile.prototype.setDescriptor = function(this: { descriptor: string }, descriptor: string) {
    this.descriptor = descriptor
  }

  NotiaDrawioFile.prototype.getLatestVersion = function(
    this: { title: string; getData: () => string; descriptor: string; path: string; persistSource: (nextSource: string) => Promise<void> },
    success?: (file: unknown) => void,
  ) {
    const NotiaDrawioFileConstructor = NotiaDrawioFile as unknown as new (
      ui: DrawioUi,
      data: string,
      descriptor: DrawioDocumentBridge,
    ) => unknown
    success?.(new NotiaDrawioFileConstructor(
      (this as unknown as { ui: DrawioUi }).ui,
      this.getData(),
      {
        title: this.title,
        path: this.path,
        persistSource: this.persistSource,
      },
    ))
  }

  NotiaDrawioFile.prototype.saveAs = function(
    this: { save: (...args: unknown[]) => void },
    _title: string,
    success?: () => void,
    error?: (error: unknown) => void,
    unloading?: boolean,
    overwrite?: boolean,
  ) {
    this.save(false, success, error, unloading, overwrite)
  }

  NotiaDrawioFile.prototype.save = function(
    this: {
      ui: DrawioUi
      savingFile?: boolean
      getData: () => string
      getDescriptor: () => string
      setDescriptor: (descriptor: string) => void
      setModified: (value: boolean) => void
      setShadowModified: (value: boolean) => void
      persistSource: (nextSource: string) => Promise<void>
      addUnsavedStatus: (error: Error) => void
      fileSaved: (
        savedData: string,
        lastDescriptor: string,
        success?: () => void,
        error?: (error: unknown) => void,
      ) => void
    },
    revision: boolean,
    success?: () => void,
    error?: (error: unknown) => void,
    unloading?: boolean,
    overwrite?: boolean,
    manual?: boolean,
  ) {
    drawioWindow.DrawioFile.prototype.save.call(
      this,
      revision,
      () => {
        if (this.savingFile) {
          return
        }

        const savedData = this.getData()
        const lastDescriptor = this.getDescriptor()
        this.savingFile = true
        this.setShadowModified(false)

        void this.persistSource(savedData)
          .then(() => {
            this.savingFile = false
            this.setDescriptor(this.ui.hashValue(savedData))
            this.fileSaved(savedData, lastDescriptor, success, error)
          })
          .catch((persistError) => {
            this.savingFile = false
            const normalizedError = normalizePersistError(persistError)
            this.setModified(true)
            this.setShadowModified(true)
            this.addUnsavedStatus(normalizedError)
            error?.(normalizedError)
          })
      },
      error,
      unloading,
      overwrite,
      manual,
    )
  }

  drawioWindow.NotiaDrawioFile = NotiaDrawioFile as unknown as DrawioWindow['NotiaDrawioFile']
}

async function createRuntime(assetBasePath: string): Promise<DrawioRuntime> {
  configureRuntimeGlobals(assetBasePath)
  await loadStylesheetOnce(assetBasePath, DRAWIO_STYLESHEET_IDS.graphEditor, 'styles/grapheditor.css')
  await loadStylesheetOnce(assetBasePath, DRAWIO_STYLESHEET_IDS.mxgraphCommon, 'mxgraph/css/common.css')

  for (const scriptPath of DRAWIO_SCRIPT_QUEUE) {
    await loadScriptOnce(assetBasePath, scriptPath)
  }

  installNotiaDrawioFileConstructor()

  return {
    async createUi(container: HTMLElement) {
      const drawioWindow = window as unknown as DrawioWindow

      if (drawioWindow.App.isMainCalled) {
        throw new Error('draw.io ya fue inicializado en este contexto sin manager compartido.')
      }

      return await new Promise<DrawioUi>((resolve) => {
        drawioWindow.App.main(
          (ui) => {
            applyUiGuards(ui)
            resolve(ui)
          },
          () => new drawioWindow.App(new drawioWindow.Editor(false, null, null, null, true), container) as unknown,
        )
      })
    },
    createFile(ui, descriptor) {
      const drawioWindow = window as unknown as DrawioWindow
      if (!drawioWindow.NotiaDrawioFile) {
        throw new Error('No se pudo registrar el adaptador de archivos draw.io.')
      }

      return new drawioWindow.NotiaDrawioFile(ui, descriptor.source, {
        path: descriptor.path,
        title: descriptor.name,
        persistSource: descriptor.onPersistSource,
      })
    },
  }
}

export async function loadDrawioRuntime(): Promise<DrawioRuntime> {
  if (!runtimePromise) {
    runtimePromise = createRuntime(resolveDrawioRuntimeBasePath())
  }

  return runtimePromise
}
