import { isTextFileDocument, type OpenFileDocument } from '../../../types/views/fileDocument'
import type { MarkdownWikiLinkTarget } from '../../../types/views/markdownWikiLink'
import type { InkdocPreferences } from '../../../services/preferences/inkdocSettingsStorage'
import { ImageView } from './ImageView'
import { InkdocView } from './inkdoc/InkdocView'
import { MarkdownView } from './MarkdownView'
import { TextView } from './TextView'

interface FileViewHostProps {
  document: OpenFileDocument
  onTextSourceChange: (nextSource: string) => void
  onInkdocSourcePersist: (nextSource: string) => Promise<void>
  rootPath: string | null
  libraryFilePaths: string[]
  inkdocPreferences: InkdocPreferences
  wikiLinkTargets: MarkdownWikiLinkTarget[]
  onOpenLinkedFile: (filePath: string) => void
}

export function FileViewHost({
  document,
  onTextSourceChange,
  onInkdocSourcePersist,
  rootPath,
  libraryFilePaths,
  inkdocPreferences,
  wikiLinkTargets,
  onOpenLinkedFile,
}: FileViewHostProps) {
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
          libraryFilePaths={libraryFilePaths}
          inkdocPreferences={inkdocPreferences}
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
