import { cpSync, createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Plugin, ResolvedConfig, ViteDevServer } from 'vite'

export const DRAWIO_RUNTIME_PUBLIC_BASE = '/__notia_drawio__'
const DRAWIO_ROOT_ALIAS_PREFIXES = ['/math4', '/mxgraph'] as const
const EMPTY_SOURCE_MAP_CONTENT = JSON.stringify({
  version: 3,
  sources: [],
  names: [],
  mappings: '',
})

const PROJECT_ROOT_DIRECTORY = resolve(fileURLToPath(new URL('..', import.meta.url)))
const DEFAULT_DRAWIO_WEBAPP_DIRECTORIES = [
  resolve(PROJECT_ROOT_DIRECTORY, 'vendor/drawio/webapp'),
  resolve(PROJECT_ROOT_DIRECTORY, '../extrepos/drawio-desktop/drawio/src/main/webapp'),
]

function resolveDrawioWebappDirectory(): string | null {
  const candidates = [
    process.env.NOTIA_DRAWIO_WEBAPP_PATH,
    ...DEFAULT_DRAWIO_WEBAPP_DIRECTORIES,
  ]

  for (const candidate of candidates) {
    if (!candidate) {
      continue
    }

    const absolutePath = resolve(candidate)
    if (existsSync(absolutePath)) {
      return absolutePath
    }
  }

  return null
}

function resolveMimeType(filePath: string): string {
  const extension = extname(filePath).toLowerCase()

  switch (extension) {
    case '.css':
      return 'text/css; charset=utf-8'
    case '.gif':
      return 'image/gif'
    case '.htm':
    case '.html':
      return 'text/html; charset=utf-8'
    case '.ico':
      return 'image/x-icon'
    case '.jpeg':
    case '.jpg':
      return 'image/jpeg'
    case '.js':
      return 'text/javascript; charset=utf-8'
    case '.json':
      return 'application/json; charset=utf-8'
    case '.map':
      return 'application/json; charset=utf-8'
    case '.png':
      return 'image/png'
    case '.svg':
      return 'image/svg+xml'
    case '.txt':
    case '.xml':
      return 'text/plain; charset=utf-8'
    case '.woff':
      return 'font/woff'
    case '.woff2':
      return 'font/woff2'
    case '.ttf':
      return 'font/ttf'
    case '.webp':
      return 'image/webp'
    default:
      return 'application/octet-stream'
  }
}

function resolveRequestedAssetPath(rootDirectory: string, requestPath: string): string | null {
  const normalizedRequestPath = requestPath.split('?')[0].split('#')[0]
  const safeRelativePath = normalizedRequestPath === '/' ? 'index.html' : normalizedRequestPath.replace(/^\/+/, '')
  const absolutePath = normalize(join(rootDirectory, safeRelativePath))

  if (!absolutePath.startsWith(rootDirectory)) {
    return null
  }

  if (existsSync(absolutePath) && statSync(absolutePath).isDirectory()) {
    const indexPath = join(absolutePath, 'index.html')
    return existsSync(indexPath) ? indexPath : null
  }

  return existsSync(absolutePath) ? absolutePath : null
}

function writeEmptySourceMapResponse(response: NodeJS.WritableStream & {
  end: (chunk?: string) => void
  setHeader: (name: string, value: string) => void
  statusCode: number
}): void {
  response.statusCode = 200
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', 'no-cache')
  response.end(EMPTY_SOURCE_MAP_CONTENT)
}

function serveResolvedAsset(
  rootDirectory: string,
  requestPath: string,
  response: NodeJS.WritableStream & {
    end: (chunk?: string) => void
    setHeader: (name: string, value: string) => void
    statusCode: number
  },
): boolean {
  const resolvedAssetPath = resolveRequestedAssetPath(rootDirectory, requestPath)
  if (!resolvedAssetPath) {
    if (requestPath.split('?')[0].endsWith('.map')) {
      writeEmptySourceMapResponse(response)
      return true
    }

    return false
  }

  response.statusCode = 200
  response.setHeader('Content-Type', resolveMimeType(resolvedAssetPath))
  response.setHeader('Cache-Control', 'no-cache')
  createReadStream(resolvedAssetPath).pipe(response)
  return true
}

function shouldServeRootAlias(requestPath: string): boolean {
  const normalizedRequestPath = requestPath.split('?')[0].split('#')[0]
  return DRAWIO_ROOT_ALIAS_PREFIXES.some((prefix) => (
    normalizedRequestPath === prefix || normalizedRequestPath.startsWith(`${prefix}/`)
  ))
}

function serveDrawioRuntimeAssets(server: ViteDevServer, rootDirectory: string): void {
  server.middlewares.use(DRAWIO_RUNTIME_PUBLIC_BASE, (request, response, next) => {
    if (!request.url) {
      next()
      return
    }

    if (!serveResolvedAsset(rootDirectory, request.url, response)) {
      response.statusCode = 404
      response.end('Not found')
    }
  })

  server.middlewares.use((request, response, next) => {
    if (!request.url || !shouldServeRootAlias(request.url)) {
      next()
      return
    }

    if (!serveResolvedAsset(rootDirectory, request.url, response)) {
      response.statusCode = 404
      response.end('Not found')
    }
  })
}

function copyDrawioRuntimeAssets(sourceDirectory: string, targetDirectory: string): void {
  cpSync(sourceDirectory, targetDirectory, {
    recursive: true,
    force: true,
  })
}

function copyDrawioRootAliasAssets(sourceDirectory: string, outputDirectory: string): void {
  for (const aliasPrefix of DRAWIO_ROOT_ALIAS_PREFIXES) {
    const relativeAliasPath = aliasPrefix.replace(/^\/+/, '')
    const sourceAliasPath = join(sourceDirectory, relativeAliasPath)
    if (!existsSync(sourceAliasPath)) {
      continue
    }

    cpSync(sourceAliasPath, join(outputDirectory, relativeAliasPath), {
      recursive: true,
      force: true,
    })
  }
}

function ensurePlaceholderSourceMaps(outputDirectory: string): void {
  const placeholderMapPaths = [
    join(outputDirectory, DRAWIO_RUNTIME_PUBLIC_BASE.replace(/^\/+/, ''), 'js', 'purify.min.js.map'),
  ]

  for (const placeholderPath of placeholderMapPaths) {
    if (existsSync(placeholderPath)) {
      continue
    }

    mkdirSync(dirname(placeholderPath), { recursive: true })
    writeFileSync(placeholderPath, EMPTY_SOURCE_MAP_CONTENT, 'utf8')
  }
}

export function createDrawioRuntimePlugin(): Plugin {
  const drawioWebappDirectory = resolveDrawioWebappDirectory()

  return {
    name: 'notia-drawio-runtime',
    apply: 'serve',
    configResolved(config) {
      if (!drawioWebappDirectory) {
        config.logger.warn(
          '[notia] draw.io runtime not found. Set NOTIA_DRAWIO_WEBAPP_PATH or initialize drawio-desktop/drawio.',
        )
      }
    },
    configureServer(server) {
      if (!drawioWebappDirectory) {
        return
      }

      serveDrawioRuntimeAssets(server, drawioWebappDirectory)
    },
  }
}

export function copyDrawioRuntimeIntoBuild(): Plugin {
  const drawioWebappDirectory = resolveDrawioWebappDirectory()
  let resolvedConfig: ResolvedConfig | null = null

  return {
    name: 'notia-drawio-runtime-build',
    apply: 'build',
    configResolved(config) {
      resolvedConfig = config
    },
    writeBundle() {
      if (!drawioWebappDirectory) {
        const outputLabel = resolvedConfig?.build.outDir ? basename(resolvedConfig.build.outDir) : 'dist'
        throw new Error(
          `[notia] draw.io runtime not found. Cannot emit assets into ${outputLabel}. ` +
          'Set NOTIA_DRAWIO_WEBAPP_PATH or initialize drawio-desktop/drawio.',
        )
      }

      if (!resolvedConfig) {
        return
      }

      copyDrawioRuntimeAssets(
        drawioWebappDirectory,
        join(resolvedConfig.build.outDir, DRAWIO_RUNTIME_PUBLIC_BASE.replace(/^\/+/, '')),
      )
      copyDrawioRootAliasAssets(drawioWebappDirectory, resolvedConfig.build.outDir)
      ensurePlaceholderSourceMaps(resolvedConfig.build.outDir)
    },
  }
}
