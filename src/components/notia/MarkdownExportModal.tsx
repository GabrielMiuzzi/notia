import { FileText, LoaderCircle, X } from 'lucide-react'
import { NotiaButton } from '../common/NotiaButton'
import { NotiaModalShell } from './NotiaModalShell'
import type { MarkdownExportFormat } from '../../modules/markdown-export/markdownExportEngine'

interface MarkdownExportModalProps {
  open: boolean
  exportingFormat: MarkdownExportFormat | null
  error: string | null
  onExport: (format: MarkdownExportFormat) => void
  onClose: () => void
}

export function MarkdownExportModal({
  open,
  exportingFormat,
  error,
  onExport,
  onClose,
}: MarkdownExportModalProps) {
  return (
    <NotiaModalShell open={open} onClose={exportingFormat ? () => undefined : onClose} size="sm" panelClassName="notia-markdown-export-modal">
      <div className="notia-markdown-export-modal-header">
        <div>
          <h2>Exportar documento</h2>
          <p>Elegí el formato de salida.</p>
        </div>
        <NotiaButton size="icon" variant="ghost" title="Cerrar" onClick={onClose} disabled={Boolean(exportingFormat)}>
          <X size={17} />
        </NotiaButton>
      </div>
      <div className="notia-markdown-export-options">
        <button type="button" onClick={() => onExport('google-docs')} disabled={Boolean(exportingFormat)}>
          {exportingFormat === 'google-docs' ? <LoaderCircle className="notia-spin" size={24} /> : <FileText size={24} />}
          <span><strong>Google Docs</strong><small>Documento .docx importable en Google Docs</small></span>
        </button>
        <button type="button" onClick={() => onExport('pdf')} disabled={Boolean(exportingFormat)}>
          {exportingFormat === 'pdf' ? <LoaderCircle className="notia-spin" size={24} /> : <FileText size={24} />}
          <span><strong>PDF</strong><small>Documento paginado listo para compartir</small></span>
        </button>
      </div>
      {error ? <p className="notia-markdown-export-error" role="alert">{error}</p> : null}
    </NotiaModalShell>
  )
}
