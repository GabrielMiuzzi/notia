import { useEffect, useMemo, useRef } from 'react'
import { InkDocView } from '../../../../modules/inkdoc/InkDocView'
import { createInkdocApp, type InkdocHostBridge } from '../../../../modules/inkdoc/engines/platform/inkdocPlatform'
import InkDocPlugin from '../../../../modules/inkdoc/main'
import { createInkdocFile, createInkdocFolder, pathExists, writeBinaryFile } from '../../../../modules/inkdoc/services/inkdocFilesystemRuntime'
import type { InkdocPreferences } from '../../../../services/preferences/inkdocSettingsStorage'
import { readLibraryFileContent, writeLibraryFileContent } from '../../../../services/libraries/libraryDocumentRuntime'
import { performLibraryEntryOperation } from '../../../../services/libraries/libraryRuntime'
import '../../../../modules/inkdoc/inkdoc.css'
import 'katex/dist/katex.min.css'

interface InkdocViewProps {
  filePath: string
  source: string
  rootPath: string | null
  libraryFilePaths: string[]
  inkdocPreferences: InkdocPreferences
  onSourcePersist: (nextSource: string) => Promise<void>
  onOpenLinkedFile: (filePath: string) => void
}

export function InkdocView({
  filePath,
  source,
  rootPath,
  libraryFilePaths,
  inkdocPreferences,
  onSourcePersist,
  onOpenLinkedFile,
}: InkdocViewProps) {
  const mountRef = useRef<HTMLDivElement | null>(null)
  const sourceRef = useRef(source)
  const filePathRef = useRef(filePath)
  const pathsRef = useRef(libraryFilePaths)
  const onSourcePersistRef = useRef(onSourcePersist)
  const onOpenLinkedFileRef = useRef(onOpenLinkedFile)

  sourceRef.current = source
  filePathRef.current = filePath
  pathsRef.current = libraryFilePaths
  onSourcePersistRef.current = onSourcePersist
  onOpenLinkedFileRef.current = onOpenLinkedFile

  const bridge = useMemo<InkdocHostBridge>(() => {
    const resolvedRootPath = rootPath ?? filePath.replace(/[/\\][^/\\]+$/, '')

    return {
      rootPath: resolvedRootPath,
      getActiveFilePath: () => filePathRef.current,
      listFilePaths: () => pathsRef.current,
      readFile: async (absolutePath) => {
        if (absolutePath === filePathRef.current) {
          return sourceRef.current
        }

        const result = await readLibraryFileContent(absolutePath)
        if (!result.ok) {
          throw new Error(result.error ?? 'Could not read file.')
        }

        return result.content
      },
      writeFile: async (absolutePath, content) => {
        if (absolutePath === filePathRef.current) {
          await onSourcePersistRef.current(content)
          sourceRef.current = content
          return
        }

        const result = await writeLibraryFileContent(absolutePath, content)
        if (!result.ok) {
          throw new Error(result.error ?? 'Could not write file.')
        }
      },
      createFile: async (absolutePath, content) => {
        await createInkdocFile(absolutePath, content)
      },
      createFolder: async (absolutePath) => {
        await createInkdocFolder(absolutePath)
      },
      deletePath: async (absolutePath) => {
        await performLibraryEntryOperation({ action: 'delete', targetPath: absolutePath })
      },
      existsPath: async (absolutePath) => {
        return pathExists(absolutePath)
      },
      writeBinaryFile: async (absolutePath, data) => {
        await writeBinaryFile(absolutePath, data)
      },
      onOpenFile: async (absolutePath) => {
        onOpenLinkedFileRef.current(absolutePath)
      },
    }
  }, [filePath, rootPath])

  useEffect(() => {
    const mountNode = mountRef.current
    if (!mountNode) {
      return
    }

    const app = createInkdocApp(bridge)
    const plugin = new InkDocPlugin(app, {
      inkmathServiceUrl: inkdocPreferences.inkmathServiceUrl,
      inkmathDebounceMs: inkdocPreferences.inkmathDebounceMs,
    })
    const leaf = app.workspace.getLeaf(false)
    const view = new InkDocView(leaf, plugin)

    let cancelled = false

    void (async () => {
      await view.onOpen()
      if (cancelled) {
        await view.onClose()
        return
      }

      mountNode.empty()
      mountNode.appendChild((view as unknown as { containerEl: HTMLDivElement }).containerEl)
      await view.setState({ file: filePath })
    })()

    return () => {
      cancelled = true
      void view.onClose()
      mountNode.empty()
    }
  }, [bridge, filePath, inkdocPreferences.inkmathDebounceMs, inkdocPreferences.inkmathServiceUrl])

  return <div ref={mountRef} className="notia-inkdoc-host" />
}
