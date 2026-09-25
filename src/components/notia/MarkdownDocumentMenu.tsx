import { useEffect, useRef, useState } from 'react'
import { Download, Ellipsis, FileText, PanelsTopLeft, PenLine, Settings } from 'lucide-react'
import type { MarkdownExportFormat } from '../../modules/markdown-export/markdownExportEngine'
import './markdownDocumentMenu.css'

interface MarkdownDocumentMenuProps {
  /** `null` while the preferences load. */
  pageMode: boolean | null
  /** Paper format in page mode, «Continuo» otherwise. */
  pageSizeLabel: string
  /** From Rust: a PDF is only exported with page mode on. */
  canExportPdf: boolean
  exportingFormat: MarkdownExportFormat | null
  onTogglePageMode: () => void
  onOpenPageSettings: () => void
  onOpenPenSettings: () => void
  onExport: (format: MarkdownExportFormat) => void
}

/** Options of the open note: page mode, its settings, the pen and the exports. */
export function MarkdownDocumentMenu({
  pageMode,
  pageSizeLabel,
  canExportPdf,
  exportingFormat,
  onTogglePageMode,
  onOpenPageSettings,
  onOpenPenSettings,
  onExport,
}: MarkdownDocumentMenuProps) {
  const [isOpen, setIsOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen) return
    const closeOutside = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setIsOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false)
    }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [isOpen])

  const run = (action: () => void) => {
    setIsOpen(false)
    action()
  }
  const isExporting = exportingFormat !== null

  return (
    <div className="notia-markdown-document-menu" ref={menuRef}>
      <button
        type="button"
        className="notia-markdown-document-menu-trigger"
        aria-label="Más opciones"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((current) => !current)}
      >
        <Ellipsis size={18} />
      </button>
      {isOpen ? (
        <div className="notia-document-menu" role="menu" aria-label="Opciones del archivo">
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={pageMode === true}
            disabled={pageMode === null}
            className="notia-document-menu-item"
            onClick={onTogglePageMode}
          >
            <span className="notia-document-menu-label"><FileText size={15} aria-hidden="true" />Modo página</span>
            <span className="notia-document-menu-switch" aria-hidden="true" />
          </button>
          <button type="button" role="menuitem" className="notia-document-menu-item" disabled={pageMode === null} onClick={() => run(onOpenPageSettings)}>
            <span className="notia-document-menu-label"><PanelsTopLeft size={15} aria-hidden="true" />Tamaño de página</span>
            <span className="notia-document-menu-value">{pageSizeLabel} ›</span>
          </button>
          <span className="notia-document-menu-divider" aria-hidden="true" />
          <button type="button" role="menuitem" className="notia-document-menu-item" onClick={() => run(onOpenPageSettings)}>
            <span className="notia-document-menu-label"><Settings size={15} aria-hidden="true" />Configuración…</span>
            <kbd className="notia-document-menu-shortcut">Ctrl ,</kbd>
          </button>
          <button type="button" role="menuitem" className="notia-document-menu-item" onClick={() => run(onOpenPenSettings)}>
            <span className="notia-document-menu-label"><PenLine size={15} aria-hidden="true" />Lápiz</span>
            <span className="notia-document-menu-soon">Próximamente</span>
          </button>
          <span className="notia-document-menu-divider" aria-hidden="true" />
          <button
            type="button"
            role="menuitem"
            className={`notia-document-menu-item${canExportPdf ? '' : ' has-hint'}`}
            disabled={isExporting || !canExportPdf}
            onClick={() => run(() => onExport('pdf'))}
          >
            <span className="notia-document-menu-label"><Download size={15} aria-hidden="true" />{exportingFormat === 'pdf' ? 'Exportando PDF…' : 'Exportar como PDF'}</span>
            {canExportPdf ? null : <span className="notia-document-menu-hint">Requiere modo página</span>}
          </button>
          <button type="button" role="menuitem" className="notia-document-menu-item" disabled={isExporting} onClick={() => run(() => onExport('google-docs'))}>
            <span className="notia-document-menu-label"><Download size={15} aria-hidden="true" />{exportingFormat === 'google-docs' ? 'Exportando Word…' : 'Exportar como Word'}</span>
          </button>
        </div>
      ) : null}
    </div>
  )
}
