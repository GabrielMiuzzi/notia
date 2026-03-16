import { FileViewHost } from './views/FileViewHost'
import type { InkdocPreferences } from '../../services/preferences/inkdocSettingsStorage'
import { isTextFileDocument, type NotiaDocumentSaveStatus, type OpenFileDocument } from '../../types/views/fileDocument'
import type { MarkdownWikiLinkTarget } from '../../types/views/markdownWikiLink'
import { NotiaButton } from '../common/NotiaButton'
import type { DrawioDocumentController } from '../../modules/drawio/types'

interface MainViewProps {
  activeDocument: OpenFileDocument | null
  saveStatus: NotiaDocumentSaveStatus
  onTextDocumentChange: (nextSource: string) => void
  onInkdocDocumentPersist: (nextSource: string) => Promise<void>
  onDrawioDocumentPersist: (filePath: string, nextSource: string) => Promise<void>
  onDrawioControllerReady: (filePath: string, controller: DrawioDocumentController | null) => void
  rootPath: string | null
  libraryFilePaths: string[]
  inkdocPreferences: InkdocPreferences
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
  onInkdocDocumentPersist,
  onDrawioDocumentPersist,
  onDrawioControllerReady,
  rootPath,
  libraryFilePaths,
  inkdocPreferences,
  markdownWikiLinkTargets,
  onOpenLinkedFile,
}: MainViewProps) {
  if (!activeDocument) {
    return (
      <main className="notia-main">
        <div className="notia-main-empty">
          <NotiaButton>Create new note (Ctrl + N)</NotiaButton>
          <NotiaButton>Go to file (Ctrl + O)</NotiaButton>
          <NotiaButton>Close</NotiaButton>
        </div>
      </main>
    )
  }

  const extensionLabel = activeDocument.extension ? `.${activeDocument.extension}` : 'sin extension'
  const isTextDocument = isTextFileDocument(activeDocument)
  const shouldShowSaveStatus = isTextDocument || activeDocument.viewKind === 'drawio'

  return (
    <main className="notia-main">
      <header className="notia-main-header">
        <div className="notia-main-title-group">
          <h2>{activeDocument.name}</h2>
          <span>{extensionLabel}</span>
        </div>
        {shouldShowSaveStatus ? (
          <span className={`notia-main-save-status notia-main-save-status--${saveStatus}`}>
            {getSaveStatusLabel(saveStatus)}
          </span>
        ) : null}
      </header>
      <section className="notia-main-content">
        <FileViewHost
          document={activeDocument}
          onTextSourceChange={onTextDocumentChange}
          onInkdocSourcePersist={onInkdocDocumentPersist}
          onDrawioSourcePersist={onDrawioDocumentPersist}
          onDrawioControllerReady={onDrawioControllerReady}
          rootPath={rootPath}
          libraryFilePaths={libraryFilePaths}
          inkdocPreferences={inkdocPreferences}
          wikiLinkTargets={markdownWikiLinkTargets}
          onOpenLinkedFile={onOpenLinkedFile}
        />
      </section>
    </main>
  )
}
