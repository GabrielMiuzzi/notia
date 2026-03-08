import { isTextFileDocument, type OpenFileDocument } from '../../../types/views/fileDocument'
import type { MarkdownWikiLinkTarget } from '../../../types/views/markdownWikiLink'
import { ImageView } from './ImageView'
import { MarkdownView } from './MarkdownView'
import { TextView } from './TextView'

interface FileViewHostProps {
  document: OpenFileDocument
  onTextSourceChange: (nextSource: string) => void
  wikiLinkTargets: MarkdownWikiLinkTarget[]
  onOpenLinkedFile: (filePath: string) => void
}

export function FileViewHost({
  document,
  onTextSourceChange,
  wikiLinkTargets,
  onOpenLinkedFile,
}: FileViewHostProps) {
  if (document.viewKind === 'image') {
    return <ImageView imageUrl={document.imageUrl} alt={document.name} />
  }

  if (!isTextFileDocument(document)) {
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
