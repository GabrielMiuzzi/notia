import { useState } from 'react'
import { BookPlus, X } from 'lucide-react'
import { pickLibraryDirectory } from '../../services/libraries/libraryRuntime'
import type { NotiaLibrary } from '../../types/notia'

interface LibraryManagerModalProps {
  open: boolean
  libraries: NotiaLibrary[]
  activeLibraryId: string | null
  onLibraryAdded: (library: NotiaLibrary) => void
  onClose: () => void
}

export function LibraryManagerModal({
  open,
  libraries,
  activeLibraryId,
  onLibraryAdded,
  onClose,
}: LibraryManagerModalProps) {
  const [isAdding, setIsAdding] = useState(false)

  if (!open) {
    return null
  }

  const handleAddLibrary = async () => {
    setIsAdding(true)
    try {
      const selection = await pickLibraryDirectory()
      if (!selection) {
        return
      }

      const newLibrary: NotiaLibrary = {
        id: crypto.randomUUID(),
        name: selection.name,
        path: selection.path,
      }
      onLibraryAdded(newLibrary)
    } finally {
      setIsAdding(false)
    }
  }

  return (
    <div className="notia-modal-backdrop" onClick={onClose}>
      <div
        className="notia-library-manager-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="notia-library-manager-header">
          <h2>Administrar librerias</h2>
          <button
            type="button"
            className="notia-settings-close"
            title="Cerrar"
            onClick={onClose}
          >
            <X size={16} />
          </button>
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
                  <div className="notia-library-manager-item-name">{library.name}</div>
                  <div className="notia-library-manager-item-path">{library.path}</div>
                </div>
              ))
            ) : (
              <div className="notia-library-manager-empty">Todavia no agregaste librerias.</div>
            )}
          </div>
          <aside className="notia-library-manager-menu">
            <button
              type="button"
              className="notia-library-manager-menu-item"
              onClick={handleAddLibrary}
              disabled={isAdding}
            >
              <BookPlus size={14} />
              <span>{isAdding ? 'Seleccionando carpeta...' : 'Agregar nueva libreria'}</span>
            </button>
          </aside>
        </div>
      </div>
    </div>
  )
}
