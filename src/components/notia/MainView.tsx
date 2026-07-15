import { memo, useCallback } from 'react'
import { FileViewHost } from './views/FileViewHost' // memoized export
import type { InkdocPreferences } from '../../services/preferences/inkdocSettingsStorage'
import type { AiPreferences } from '../../services/preferences/aiSettingsStorage'
import { isTextFileDocument, type NotiaDocumentSaveStatus, type OpenFileDocument } from '../../types/views/fileDocument'
import type { MarkdownWikiLinkTarget } from '../../types/views/markdownWikiLink'
import { NotiaButton } from '../common/NotiaButton'

interface MainViewProps {
  activeDocument: OpenFileDocument | null
  saveStatus: NotiaDocumentSaveStatus
  onTextDocumentChange: (nextSource: string) => void
  onInkdocDocumentPersist: (nextSource: string) => Promise<void>
  rootPath: string | null
  libraryAndroidTreeUri?: string
  libraryFilePaths: string[]
  inkdocPreferences: InkdocPreferences
  aiPreferences: AiPreferences
  markdownWikiLinkTargets: MarkdownWikiLinkTarget[]
  onOpenLinkedFile: (filePath: string) => void
  theme: string
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

function MainViewComponent({
  activeDocument,
  saveStatus,
  onTextDocumentChange,
  onInkdocDocumentPersist,
  rootPath,
  libraryAndroidTreeUri,
  libraryFilePaths,
  inkdocPreferences,
  aiPreferences,
  markdownWikiLinkTargets,
  onOpenLinkedFile,
  theme,
}: MainViewProps) {
  const handleNewNote = useCallback(() => {
    // Placeholder shortcut handler; currently rendered as static UI hint.
  }, [])

  const handleGoToFile = useCallback(() => {
    // Placeholder shortcut handler; currently rendered as static UI hint.
  }, [])

  const handleClose = useCallback(() => {
    // Placeholder shortcut handler; currently rendered as static UI hint.
  }, [])

  if (!activeDocument) {
    return (
      <main className="notia-main" data-notia-prevent-menu-close>
        <div className="notia-main-empty">
          <NotiaButton onClick={handleNewNote}>Create new note (Ctrl + N)</NotiaButton>
          <NotiaButton onClick={handleGoToFile}>Go to file (Ctrl + O)</NotiaButton>
          <NotiaButton onClick={handleClose}>Close</NotiaButton>
        </div>
      </main>
    )
  }

  const extensionLabel = activeDocument.extension ? `.${activeDocument.extension}` : 'sin extension'
  const isTextDocument = isTextFileDocument(activeDocument)

  return (
    <main className="notia-main" data-notia-prevent-menu-close>
      <header className="notia-main-header" data-notia-prevent-menu-close>
        <div className="notia-main-title-group" data-notia-prevent-menu-close>
          <h2>{activeDocument.name}</h2>
          <span>{extensionLabel}</span>
        </div>
        {isTextDocument ? (
          <span className={`notia-main-save-status notia-main-save-status--${saveStatus}`}>
            {getSaveStatusLabel(saveStatus)}
          </span>
        ) : null}
      </header>
      <section className="notia-main-content" data-notia-prevent-menu-close>
        <FileViewHost
          document={activeDocument}
          onTextSourceChange={onTextDocumentChange}
          onInkdocSourcePersist={onInkdocDocumentPersist}
          rootPath={rootPath}
          libraryAndroidTreeUri={libraryAndroidTreeUri}
          libraryFilePaths={libraryFilePaths}
          inkdocPreferences={inkdocPreferences}
          aiPreferences={aiPreferences}
          wikiLinkTargets={markdownWikiLinkTargets}
          onOpenLinkedFile={onOpenLinkedFile}
          theme={theme}
        />
      </section>
    </main>
  )
}

export const MainView = memo(MainViewComponent)
MainView.displayName = 'MainView'
