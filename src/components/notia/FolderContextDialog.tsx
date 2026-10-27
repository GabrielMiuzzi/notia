import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { NotiaModalShell } from './NotiaModalShell'
import { NotiaButton } from '../common/NotiaButton'
import type { LibraryContext } from '../../services/contexts/libraryContexts'

const NO_CONTEXT = ''

interface FolderContextDialogProps {
  /** Name of the folder; `null` keeps the dialog closed. */
  folderName: string | null
  /** The folder's own context, if it has one. */
  current: string | null
  contexts: readonly LibraryContext[]
  saving: boolean
  error: string | null
  onSave: (context: string | null) => void
  onClose: () => void
}

/** Picks the context of a folder: one of the library's, or none. */
export function FolderContextDialog({ folderName, current, contexts, saving, error, onSave, onClose }: FolderContextDialogProps) {
  const [selected, setSelected] = useState(current ?? NO_CONTEXT)

  useEffect(() => {
    setSelected(current ?? NO_CONTEXT)
  }, [current, folderName])

  if (folderName === null) {
    return null
  }

  const options = [
    { tag: NO_CONTEXT, label: 'Sin contexto', color: null as string | null },
    ...contexts.map((context) => ({ tag: context.tag, label: context.tag, color: context.color })),
  ]
  const unchanged = selected === (current ?? NO_CONTEXT)

  return (
    <NotiaModalShell open onClose={onClose} size="sm" panelClassName="notia-app-dialog notia-folder-context-dialog">
      <div className="notia-app-dialog-header">
        <h2>Contexto de «{folderName}»</h2>
        <NotiaButton size="icon" variant="ghost" className="notia-settings-close" title="Cerrar" onClick={onClose}>
          <X size={16} />
        </NotiaButton>
      </div>
      <div className="notia-app-dialog-body">
        <p className="notia-folder-context-hint">
          Las notas de esta carpeta y de sus subcarpetas toman este contexto, también las que se creen o se muevan acá.
          Una subcarpeta con su propio contexto conserva el suyo.
        </p>
        <div className="notia-folder-context-options" role="radiogroup" aria-label="Contexto de la carpeta">
          {options.map((option) => (
            <label key={option.tag || 'none'} className="notia-folder-context-option">
              <input
                type="radio"
                name="folder-context"
                value={option.tag}
                checked={selected === option.tag}
                disabled={saving}
                onChange={() => setSelected(option.tag)}
              />
              <span
                className="notia-folder-context-swatch"
                aria-hidden="true"
                style={option.color ? { background: option.color } : undefined}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
        {error ? <p className="notia-folder-context-error" role="alert">{error}</p> : null}
      </div>
      <div className="notia-app-dialog-actions">
        <NotiaButton variant="secondary" className="notia-app-dialog-button" onClick={onClose} disabled={saving}>
          Cancelar
        </NotiaButton>
        <NotiaButton
          variant="primary"
          className="notia-app-dialog-button notia-app-dialog-button--primary"
          disabled={saving || unchanged}
          onClick={() => onSave(selected === NO_CONTEXT ? null : selected)}
        >
          {saving ? 'Guardando…' : 'Guardar'}
        </NotiaButton>
      </div>
    </NotiaModalShell>
  )
}
