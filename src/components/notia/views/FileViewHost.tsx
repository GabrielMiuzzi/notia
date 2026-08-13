import { memo, Suspense, useCallback, lazy } from 'react'
import { isTextFileDocument, type OpenFileDocument } from '../../../types/views/fileDocument'
import type { MarkdownWikiLinkTarget } from '../../../types/views/markdownWikiLink'
import type { InkdocPreferences } from '../../../services/preferences/inkdocSettingsStorage'
import type { AiPreferences } from '../../../services/preferences/aiSettingsStorage'
import { ImageView } from './ImageView'
import { TextView } from './TextView'

const MarkdownView = lazy(async () => {
  const module = await import('./MarkdownView')
  return { default: module.MarkdownView }
})
const MermaidView = lazy(async () => {
  const module = await import('./mermaid/MermaidView')
  return { default: module.MermaidView }
})
const InkdocView = lazy(async () => {
  const module = await import('./inkdoc/InkdocView')
  return { default: module.InkdocView }
})

function FileViewFallback() {
  return (
    <div className="notia-main" role="status" aria-live="polite">
      <div className="notia-workspace-deferred-view">
        <div className="notia-workspace-deferred-card">
          <strong>Cargando editor...</strong>
        </div>
      </div>
    </div>
  )
}

interface FileViewHostProps {
  document: OpenFileDocument
  onTextSourceChange: (nextSource: string) => void
  onInkdocSourcePersist: (nextSource: string) => Promise<void>
  rootPath: string | null
  libraryAndroidTreeUri?: string
  libraryFilePaths: string[]
  inkdocPreferences: InkdocPreferences
  aiPreferences: AiPreferences
  wikiLinkTargets: MarkdownWikiLinkTarget[]
  onOpenLinkedFile: (filePath: string) => void
  theme: string
  markdownZoom: number
  onMarkdownZoomChange: (zoom: number) => void
}

function FileViewHostComponent({
  document,
  onTextSourceChange,
  onInkdocSourcePersist,
  rootPath,
  libraryAndroidTreeUri,
  libraryFilePaths,
  inkdocPreferences,
  aiPreferences,
  wikiLinkTargets,
  onOpenLinkedFile,
  theme,
  markdownZoom,
  onMarkdownZoomChange,
}: FileViewHostProps) {
  const handleMermaidSourcePersist = useCallback(async (nextSource: string) => {
    onTextSourceChange(nextSource)
  }, [onTextSourceChange])
  if (document.viewKind === 'image') {
    return <ImageView imageUrl={document.imageUrl} alt={document.name} />
  }

  if (document.viewKind === 'mermaid') {
    return (
      <Suspense fallback={<FileViewFallback />}>
        <MermaidView
          filePath={document.path}
          source={document.source}
          onSourcePersist={handleMermaidSourcePersist}
        />
      </Suspense>
    )
  }

  if (!isTextFileDocument(document)) {
    if (document.viewKind === 'inkdoc') {
      return (
        <Suspense fallback={<FileViewFallback />}>
          <InkdocView
            filePath={document.path}
            source={document.source}
            rootPath={rootPath}
            libraryAndroidTreeUri={libraryAndroidTreeUri}
            libraryFilePaths={libraryFilePaths}
            inkdocPreferences={inkdocPreferences}
            aiPreferences={aiPreferences}
            onSourcePersist={onInkdocSourcePersist}
            onOpenLinkedFile={onOpenLinkedFile}
          />
        </Suspense>
      )
    }

    return null
  }

  if (document.viewKind === 'markdown') {
    return (
      <Suspense fallback={<FileViewFallback />}>
        <MarkdownView
          key={document.path}
          source={document.source}
          documentPath={document.path}
          onSourceChange={onTextSourceChange}
          wikiLinkTargets={wikiLinkTargets}
          onOpenLinkedFile={onOpenLinkedFile}
          theme={theme}
          zoom={markdownZoom}
          onZoomChange={onMarkdownZoomChange}
        />
      </Suspense>
    )
  }

  if (document.viewKind === 'text') {
    return <TextView source={document.source} onSourceChange={onTextSourceChange} />
  }

  return null
}

export const FileViewHost = memo(FileViewHostComponent)
FileViewHost.displayName = 'FileViewHost'
