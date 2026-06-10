import { memo } from 'react'
import { isTextFileDocument, type OpenFileDocument } from '../../../types/views/fileDocument'
import type { MarkdownWikiLinkTarget } from '../../../types/views/markdownWikiLink'
import type { InkdocPreferences } from '../../../services/preferences/inkdocSettingsStorage'
import type { AiPreferences } from '../../../services/preferences/aiSettingsStorage'
import { ImageView } from './ImageView'
import { InkdocView } from './inkdoc/InkdocView'
import { MarkdownView } from './MarkdownView'
import { MermaidView } from './mermaid/MermaidView'
import { TextView } from './TextView'

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
}: FileViewHostProps) {
  if (document.viewKind === 'image') {
    return <ImageView imageUrl={document.imageUrl} alt={document.name} />
  }

  if (document.viewKind === 'mermaid') {
    return (
      <MermaidView
        filePath={document.path}
        source={document.source}
        onSourcePersist={async (nextSource) => onTextSourceChange(nextSource)}
      />
    )
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

    return null
  }

  if (document.viewKind === 'markdown') {
    return (
      <MarkdownView
        key={document.path}
        source={document.source}
        documentPath={document.path}
        onSourceChange={onTextSourceChange}
        wikiLinkTargets={wikiLinkTargets}
        onOpenLinkedFile={onOpenLinkedFile}
        theme={theme}
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