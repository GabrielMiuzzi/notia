import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { Ellipsis } from 'lucide-react'
import { FileViewHost } from './views/FileViewHost' // memoized export
import { isTextFileDocument, type NotiaDocumentSaveStatus, type OpenFileDocument } from '../../types/views/fileDocument'
import type { MarkdownWikiLinkTarget } from '../../types/views/markdownWikiLink'
import { NotiaButton } from '../common/NotiaButton'
import { MAX_MARKDOWN_ZOOM, MIN_MARKDOWN_ZOOM } from './views/markdown/useMarkdownZoom'
import { MarkdownExportModal } from './MarkdownExportModal'
import type { MarkdownExportFormat } from '../../modules/markdown-export/markdownExportEngine'

const DEFAULT_MARKDOWN_ZOOM = 1

interface MainViewProps {
  activeDocument: OpenFileDocument | null
  saveStatus: NotiaDocumentSaveStatus
  onTextDocumentChange: (nextSource: string) => void
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
  markdownWikiLinkTargets,
  onOpenLinkedFile,
  theme,
}: MainViewProps) {
  const [markdownZoom, setMarkdownZoom] = useState(DEFAULT_MARKDOWN_ZOOM)
  const [isDocumentMenuOpen, setIsDocumentMenuOpen] = useState(false)
  const [isExportModalOpen, setIsExportModalOpen] = useState(false)
  const [exportingFormat, setExportingFormat] = useState<MarkdownExportFormat | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)
  const documentMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setMarkdownZoom(DEFAULT_MARKDOWN_ZOOM)
    setIsDocumentMenuOpen(false)
    setIsExportModalOpen(false)
    setExportError(null)
  }, [activeDocument?.path])

  useEffect(() => {
    if (!isDocumentMenuOpen) return
    const closeMenu = (event: PointerEvent) => {
      if (!documentMenuRef.current?.contains(event.target as Node)) setIsDocumentMenuOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsDocumentMenuOpen(false)
    }
    document.addEventListener('pointerdown', closeMenu)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeMenu)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [isDocumentMenuOpen])

  const handleNewNote = useCallback(() => {
    // Placeholder shortcut handler; currently rendered as static UI hint.
  }, [])

  const handleGoToFile = useCallback(() => {
    // Placeholder shortcut handler; currently rendered as static UI hint.
  }, [])

  const handleClose = useCallback(() => {
    // Placeholder shortcut handler; currently rendered as static UI hint.
  }, [])

  const handleExport = useCallback(async (format: MarkdownExportFormat) => {
    if (!activeDocument || !isTextFileDocument(activeDocument) || activeDocument.viewKind !== 'markdown') return
    setExportingFormat(format)
    setExportError(null)
    try {
      const { exportMarkdownDocument } = await import('../../modules/markdown-export/markdownExportEngine')
      const exported = await exportMarkdownDocument(activeDocument.source, activeDocument.name, format)
      if (exported) setIsExportModalOpen(false)
    } catch (error) {
      setExportError(error instanceof Error ? error.message : 'No se pudo exportar el documento.')
    } finally {
      setExportingFormat(null)
    }
  }, [activeDocument])

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
  const isMarkdownDocument = activeDocument.viewKind === 'markdown'
  const markdownZoomPercent = Math.round(markdownZoom * 100)

  return (
    <main className="notia-main" data-notia-prevent-menu-close>
      <header className="notia-main-header" data-notia-prevent-menu-close>
        <div className="notia-main-title-group" data-notia-prevent-menu-close>
          <h2>{activeDocument.name}</h2>
          <span>{extensionLabel}</span>
        </div>
        <div className="notia-main-header-actions">
          {isTextDocument ? (
            <span className={`notia-main-save-status notia-main-save-status--${saveStatus}`}>
              {getSaveStatusLabel(saveStatus)}
            </span>
          ) : null}
          {isMarkdownDocument ? (
            <div className="notia-markdown-zoom-control" aria-label="Zoom del documento Markdown">
              <label htmlFor="notia-markdown-zoom" title="Zoom del documento">
                {markdownZoomPercent}%
              </label>
              <input
                id="notia-markdown-zoom"
                type="range"
                min={MIN_MARKDOWN_ZOOM * 100}
                max={MAX_MARKDOWN_ZOOM * 100}
                step="5"
                value={markdownZoomPercent}
                onChange={(event) => setMarkdownZoom(Number(event.target.value) / 100)}
                aria-valuetext={`${markdownZoomPercent}%`}
              />
              <button
                type="button"
                onClick={() => setMarkdownZoom(DEFAULT_MARKDOWN_ZOOM)}
                disabled={markdownZoom === DEFAULT_MARKDOWN_ZOOM}
              >
                Restablecer
              </button>
              <div className="notia-markdown-document-menu" ref={documentMenuRef}>
                <button
                  type="button"
                  className="notia-markdown-document-menu-trigger"
                  aria-label="Más acciones del documento"
                  aria-haspopup="menu"
                  aria-expanded={isDocumentMenuOpen}
                  onClick={() => setIsDocumentMenuOpen((isOpen) => !isOpen)}
                >
                  <Ellipsis size={18} />
                </button>
                {isDocumentMenuOpen ? (
                  <div className="notia-markdown-document-submenu" role="menu">
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setIsDocumentMenuOpen(false)
                        setExportError(null)
                        setIsExportModalOpen(true)
                      }}
                    >
                      Exportar
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </header>
      <section className="notia-main-content" data-notia-prevent-menu-close>
        <FileViewHost
          document={activeDocument}
          onTextSourceChange={onTextDocumentChange}
          wikiLinkTargets={markdownWikiLinkTargets}
          onOpenLinkedFile={onOpenLinkedFile}
          theme={theme}
          markdownZoom={markdownZoom}
          onMarkdownZoomChange={setMarkdownZoom}
        />
      </section>
      <MarkdownExportModal
        open={isExportModalOpen}
        exportingFormat={exportingFormat}
        error={exportError}
        onExport={(format) => void handleExport(format)}
        onClose={() => setIsExportModalOpen(false)}
      />
    </main>
  )
}

export const MainView = memo(MainViewComponent)
MainView.displayName = 'MainView'
