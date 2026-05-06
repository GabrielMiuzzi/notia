import { useState } from 'react'
import { BookPlus, Trash2, X } from 'lucide-react'
import { pickLibraryDirectory } from '../../services/libraries/libraryRuntime'
import { ensureLibraryConfigExists } from '../../services/libraries/libraryConfig'
import { generateUUID } from '../../utils/uuid'
import type { NotiaLibrary } from '../../types/notia'
import { NotiaModalShell } from './NotiaModalShell'
import { NotiaButton } from '../common/NotiaButton'

interface LibraryManagerModalProps {
  open: boolean
  libraries: NotiaLibrary[]
  activeLibraryId: string | null
  onLibraryAdded: (library: NotiaLibrary) => void
  onLibraryRemoved: (library: NotiaLibrary) => Promise<void>
  onClose: () => void
}

export function LibraryManagerModal({
  open,
  libraries,
  activeLibraryId,
  onLibraryAdded,
  onLibraryRemoved,
  onClose,
}: LibraryManagerModalProps) {
  const [isAdding, setIsAdding] = useState(false)
  const [addPhase, setAddPhase] = useState<string | null>(null)
  const [addErrorMessage, setAddErrorMessage] = useState<string | null>(null)

  if (!open) {
    return null
  }

  const handleAddLibrary = async () => {
    setAddErrorMessage(null)
    setIsAdding(true)
    setAddPhase('picker')
    try {
      const selection = await pickLibraryDirectory()
      if (!selection) {
        setAddPhase(null)
        return
      }

      setAddPhase('config')
      await ensureLibraryConfigExists(selection.path, {
        androidDirectoryUri: selection.androidTreeUri,
      })
      
      const newLibrary: NotiaLibrary = {
        id: generateUUID(),
        name: selection.name,
        path: selection.path,
        androidTreeUri: selection.androidTreeUri,
      }
      setAddPhase('loading')
      onLibraryAdded(newLibrary)
      onClose()
    } catch (error) {
      console.error('[LibraryManager] Error adding library:', error)
      const fallbackMessage = 'No se pudo abrir el selector de carpetas en este dispositivo.'
      if (error instanceof Error && error.message.trim()) {
        setAddErrorMessage(error.message)
      } else {
        setAddErrorMessage(fallbackMessage)
      }
    } finally {
      setIsAdding(false)
      setAddPhase(null)
    }
  }

  const phaseLabel = isAdding
    ? addPhase === 'config' ? 'Configurando libreria...'
    : addPhase === 'loading' ? 'Cargando archivos...'
    : 'Seleccionando carpeta...'
    : null

  return (
    <NotiaModalShell open={open} onClose={onClose} size="xl" panelClassName="notia-library-manager-modal">
        <div className="notia-library-manager-header">
          <h2>Administrar librerias</h2>
          <NotiaButton
            size="icon"
            variant="ghost"
            className="notia-settings-close"
            title="Cerrar"
            onClick={onClose}
          >
            <X size={16} />
          </NotiaButton>
        </div>
        <div className="notia-library-manager-body">
          <div className="notia-library-manager-list">
            {libraries.length > 0 ? (
              libraries.map((library) => (
                <div
                  key={library.id}
                  className={`notia-library-manager-item ${
                    library.id === activeLibraryId ? 'notia-library-manager-item--active' : ''
                  }`}
                >
                  <div className="notia-library-manager-item-main">
                    <div className="notia-library-manager-item-name">{library.name}</div>
                    <div className="notia-library-manager-item-path">{library.path}</div>
                  </div>
                  <NotiaButton
                    type="button"
                    size="icon"
                    variant="danger"
                    className="notia-library-manager-item-remove"
                    title={`Quitar ${library.name}`}
                    aria-label={`Quitar ${library.name}`}
                    onClick={() => {
                      void onLibraryRemoved(library)
                    }}
                  >
                    <Trash2 size={14} />
                  </NotiaButton>
                </div>
              ))
            ) : (
              <div className="notia-library-manager-empty">Todavia no agregaste librerias.</div>
            )}
          </div>
          <aside className="notia-library-manager-menu">
            <NotiaButton
              className="notia-library-manager-menu-item"
              variant="primary"
              onClick={handleAddLibrary}
              disabled={isAdding}
            >
              <BookPlus size={14} />
              <span>{phaseLabel ?? 'Agregar nueva libreria'}</span>
            </NotiaButton>
            {addErrorMessage ? (
              <div className="notia-library-manager-error" role="status">
                {addErrorMessage}
              </div>
            ) : null}
          </aside>
        </div>
    </NotiaModalShell>
  )
}
