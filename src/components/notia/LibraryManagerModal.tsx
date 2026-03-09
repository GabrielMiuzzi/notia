import { useState } from 'react'
import { BookPlus, X } from 'lucide-react'
import { pickLibraryDirectory } from '../../services/libraries/libraryRuntime'
import type { NotiaLibrary } from '../../types/notia'
import { NotiaModalShell } from './NotiaModalShell'
import { NotiaButton } from '../common/NotiaButton'

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
                  <div className="notia-library-manager-item-name">{library.name}</div>
                  <div className="notia-library-manager-item-path">{library.path}</div>
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
              <span>{isAdding ? 'Seleccionando carpeta...' : 'Agregar nueva libreria'}</span>
            </NotiaButton>
          </aside>
        </div>
    </NotiaModalShell>
  )
}
