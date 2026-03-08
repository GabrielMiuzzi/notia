import { FileViewHost } from './views/FileViewHost'
import { isTextFileDocument, type NotiaDocumentSaveStatus, type OpenFileDocument } from '../../types/views/fileDocument'
import type { MarkdownWikiLinkTarget } from '../../types/views/markdownWikiLink'

interface MainViewProps {
  activeDocument: OpenFileDocument | null
  saveStatus: NotiaDocumentSaveStatus
  onTextDocumentChange: (nextSource: string) => void
  markdownWikiLinkTargets: MarkdownWikiLinkTarget[]
  onOpenLinkedFile: (filePath: string) => void
}

function getSaveStatusLabel(status: NotiaDocumentSaveStatus): string {
  if (status === 'saving') {
    return 'Guardando...'
  }

  if (status === 'error') {
    return 'Error al guardar'
  }

  return 'Guardado'
}

export function MainView({
  activeDocument,
  saveStatus,
  onTextDocumentChange,
  markdownWikiLinkTargets,
  onOpenLinkedFile,
}: MainViewProps) {
  if (!activeDocument) {
    return (
      <main className="notia-main">
        <div className="notia-main-empty">
          <button type="button">Create new note (Ctrl + N)</button>
          <button type="button">Go to file (Ctrl + O)</button>
          <button type="button">Close</button>
        </div>
      </main>
    )
  }

  const extensionLabel = activeDocument.extension ? `.${activeDocument.extension}` : 'sin extension'
  const isTextDocument = isTextFileDocument(activeDocument)

  return (
    <main className="notia-main">
      <header className="notia-main-header">
        <div className="notia-main-title-group">
          <h2>{activeDocument.name}</h2>
          <span>{extensionLabel}</span>
        </div>
        {isTextDocument ? (
          <span className={`notia-main-save-status notia-main-save-status--${saveStatus}`}>
            {getSaveStatusLabel(saveStatus)}
          </span>
        ) : null}
      </header>
      <section className="notia-main-content">
        <FileViewHost
          document={activeDocument}
          onTextSourceChange={onTextDocumentChange}
          wikiLinkTargets={markdownWikiLinkTargets}
          onOpenLinkedFile={onOpenLinkedFile}
        />
      </section>
    </main>
  )
}
