import { memo, useEffect, useRef, useState, type ComponentType } from 'react'
import { BookOpen, CircleHelp, Settings } from 'lucide-react'
import type { NotiaLibrary } from '../../types/notia'
import { NotiaButton } from '../common/NotiaButton'
import { useSubmenuEngine } from '../../hooks/useSubmenuEngine'

interface WorkspaceFooterProps {
  name: string
  icon: ComponentType<{ size?: number }>
  libraries: NotiaLibrary[]
  activeLibraryId: string | null
  onSelectLibrary: (libraryId: string) => void
  onOpenLibraryManager: () => void
  onOpenSettings: () => void
}

function WorkspaceFooterComponent({
  name,
  icon: Icon,
  libraries,
  activeLibraryId,
  onSelectLibrary,
  onOpenLibraryManager,
  onOpenSettings,
}: WorkspaceFooterProps) {
  const [isLibraryMenuOpen, setIsLibraryMenuOpen] = useState(false)
  const openLibraryManagerTimeoutRef = useRef<number | null>(null)
  const { triggerRef, panelRef } = useSubmenuEngine<HTMLButtonElement, HTMLDivElement>({
    open: isLibraryMenuOpen,
    onClose: () => setIsLibraryMenuOpen(false),
  })

  useEffect(() => () => {
    if (openLibraryManagerTimeoutRef.current !== null) {
      window.clearTimeout(openLibraryManagerTimeoutRef.current)
    }
  }, [])

  const handleOpenLibraryManagerFromMenu = () => {
    setIsLibraryMenuOpen(false)

    if (openLibraryManagerTimeoutRef.current !== null) {
      window.clearTimeout(openLibraryManagerTimeoutRef.current)
    }

    // On Android WebView, opening the modal in the same tap that closes the
    // submenu can cause the modal to close immediately.
    openLibraryManagerTimeoutRef.current = window.setTimeout(() => {
      openLibraryManagerTimeoutRef.current = null
      onOpenLibraryManager()
    }, 0)
  }

  return (
    <div className="notia-footer">
      <div className="notia-footer-library">
        <NotiaButton
          ref={triggerRef}
          className="notia-footer-library-trigger"
          variant="ghost"
          title="Librerias"
          onClick={() => setIsLibraryMenuOpen((current) => !current)}
        >
          <Icon size={14} />
          <span>{name}</span>
        </NotiaButton>
        {isLibraryMenuOpen ? (
          <div className="notia-library-menu" ref={panelRef}>
            <div className="notia-library-menu-list">
              {libraries.length > 0 ? (
                libraries.map((library) => (
                  <NotiaButton
                    key={library.id}
                    className={`notia-library-item ${
                      library.id === activeLibraryId ? 'notia-library-item--active' : ''
                    }`}
                    variant={library.id === activeLibraryId ? 'primary' : 'secondary'}
                    onClick={() => {
                      onSelectLibrary(library.id)
                      setIsLibraryMenuOpen(false)
                    }}
                  >
                    {library.name}
                  </NotiaButton>
                ))
              ) : (
                <div className="notia-library-empty">Sin librerias disponibles</div>
              )}
            </div>
            <NotiaButton
              className="notia-library-manage"
              variant="secondary"
              onClick={handleOpenLibraryManagerFromMenu}
            >
              <BookOpen size={14} />
              <span>Administrar librerias</span>
            </NotiaButton>
          </div>
        ) : null}
      </div>
      <div className="notia-footer-actions">
        <NotiaButton type="button" className="notia-footer-button" size="icon" variant="ghost" title="Help">
          <CircleHelp size={14} />
        </NotiaButton>
        <NotiaButton
          className="notia-footer-button"
          size="icon"
          variant="ghost"
          title="Settings"
          onClick={onOpenSettings}
        >
          <Settings size={14} />
        </NotiaButton>
      </div>
    </div>
  )
}

export const WorkspaceFooter = memo(WorkspaceFooterComponent)
WorkspaceFooter.displayName = 'WorkspaceFooter'
