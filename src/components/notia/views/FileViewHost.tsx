import { memo, useCallback } from 'react'
import { isTextFileDocument, type OpenFileDocument } from '../../../types/views/fileDocument'
import type { MarkdownWikiLinkTarget } from '../../../types/views/markdownWikiLink'
import type { InkdocPreferences } from '../../../services/preferences/inkdocSettingsStorage'
import type { AiPreferences } from '../../../services/preferences/aiSettingsStorage'
import { ImageView } from './ImageView'
import { InkdocView } from './inkdoc/InkdocView'
import { MarkdownView } from './MarkdownView'
import { TextView } from './TextView'
import { DrawioView } from './drawio/DrawioView'
import type { DrawioDocumentController } from '../../../modules/drawio/types'

interface FileViewHostProps {
  document: OpenFileDocument
  onTextSourceChange: (nextSource: string) => void
  onInkdocSourcePersist: (nextSource: string) => Promise<void>
  onDrawioSourcePersist: (filePath: string, nextSource: string) => Promise<void>
  onDrawioControllerReady: (filePath: string, controller: DrawioDocumentController | null) => void
  rootPath: string | null
  libraryAndroidTreeUri?: string
  libraryFilePaths: string[]
  inkdocPreferences: InkdocPreferences
  aiPreferences: AiPreferences
  wikiLinkTargets: MarkdownWikiLinkTarget[]
  onOpenLinkedFile: (filePath: string) => void
}

function FileViewHostComponent({
  document,
  onTextSourceChange,
  onInkdocSourcePersist,
  onDrawioSourcePersist,
  onDrawioControllerReady,
  rootPath,
  libraryAndroidTreeUri,
  libraryFilePaths,
  inkdocPreferences,
  aiPreferences,
  wikiLinkTargets,
  onOpenLinkedFile,
}: FileViewHostProps) {
  const handleDrawioControllerReady = useCallback(
    (controller: DrawioDocumentController | null) => {
      onDrawioControllerReady(document.path, controller)
    },
    [document.path, onDrawioControllerReady],
  )

  if (document.viewKind === 'image') {
    return <ImageView imageUrl={document.imageUrl} alt={document.name} />
  }

  if (!isTextFileDocument(document)) {
    if (document.viewKind === 'inkdoc') {
      return (
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
      )
    }

    if (document.viewKind === 'drawio') {
      return (
        <DrawioView
          key={document.path}
          filePath={document.path}
          source={document.source}
          onSourcePersist={onDrawioSourcePersist}
          onControllerReady={handleDrawioControllerReady}
        />
      )
    }

    return null
  }

  if (document.viewKind === 'markdown') {
    return (
      <MarkdownView
        key={document.path}
        source={document.source}
        onSourceChange={onTextSourceChange}
        wikiLinkTargets={wikiLinkTargets}
        onOpenLinkedFile={onOpenLinkedFile}
      />
    )
  }

  if (document.viewKind === 'text') {
    return <TextView source={document.source} onSourceChange={onTextSourceChange} />
  }

  return null
}

export const FileViewHost = memo(FileViewHostComponent)
FileViewHost.displayName = 'FileViewHost'