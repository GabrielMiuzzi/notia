import { useEffect, useRef, useState, type ComponentType } from 'react'
import { BookOpen, CircleHelp, Settings } from 'lucide-react'
import type { NotiaLibrary } from '../../types/notia'

interface WorkspaceFooterProps {
  name: string
  icon: ComponentType<{ size?: number }>
  libraries: NotiaLibrary[]
  activeLibraryId: string | null
  onSelectLibrary: (libraryId: string) => void
  onOpenLibraryManager: () => void
  onOpenSettings: () => void
}

export function WorkspaceFooter({
  name,
  icon: Icon,
  libraries,
  activeLibraryId,
  onSelectLibrary,
  onOpenLibraryManager,
  onOpenSettings,
}: WorkspaceFooterProps) {
  const [isLibraryMenuOpen, setIsLibraryMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setIsLibraryMenuOpen(false)
      }
    }

    if (isLibraryMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isLibraryMenuOpen])

  return (
    <div className="notia-footer">
      <div className="notia-footer-library" ref={menuRef}>
        <button
          type="button"
          className="notia-footer-library-trigger"
          title="Librerias"
          onClick={() => setIsLibraryMenuOpen((current) => !current)}
        >
          <Icon size={14} />
          <span>{name}</span>
        </button>
        {isLibraryMenuOpen ? (
          <div className="notia-library-menu">
            <div className="notia-library-menu-list">
              {libraries.length > 0 ? (
                libraries.map((library) => (
                  <button
                    key={library.id}
                    type="button"
                    className={`notia-library-item ${
                      library.id === activeLibraryId ? 'notia-library-item--active' : ''
                    }`}
                    onClick={() => {
                      onSelectLibrary(library.id)
                      setIsLibraryMenuOpen(false)
                    }}
                  >
                    {library.name}
                  </button>
                ))
              ) : (
                <div className="notia-library-empty">Sin librerias disponibles</div>
              )}
            </div>
            <button
              type="button"
              className="notia-library-manage"
              onClick={() => {
                setIsLibraryMenuOpen(false)
                onOpenLibraryManager()
              }}
            >
              <BookOpen size={14} />
              <span>Administrar librerias</span>
            </button>
          </div>
        ) : null}
      </div>
      <div className="notia-footer-actions">
        <button type="button" className="notia-footer-button" title="Help">
          <CircleHelp size={14} />
        </button>
        <button
          type="button"
          className="notia-footer-button"
          title="Settings"
          onClick={onOpenSettings}
        >
          <Settings size={14} />
        </button>
      </div>
    </div>
  )
}
