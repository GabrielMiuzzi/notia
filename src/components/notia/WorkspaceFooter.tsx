import { memo, useState, type MouseEvent } from 'react'
import { BookOpen, Check, ChevronsUpDown, Library } from 'lucide-react'
import type { NotiaLibrary } from '../../types/notia'
import { useSubmenuEngine } from '../../hooks/useSubmenuEngine'
import { beginPhantomClickSuppression } from '../../utils/interactions/phantomClickSuppression'

interface WorkspaceFooterProps {
  name: string
  libraries: NotiaLibrary[]
  activeLibraryId: string | null
  onSelectLibrary: (libraryId: string) => void
  onOpenLibraryManager: () => void
}

function WorkspaceFooterComponent({
  name,
  libraries,
  activeLibraryId,
  onSelectLibrary,
  onOpenLibraryManager,
}: WorkspaceFooterProps) {
  const [isLibraryMenuOpen, setIsLibraryMenuOpen] = useState(false)
  const { triggerRef, panelRef } = useSubmenuEngine<HTMLButtonElement, HTMLDivElement>({
    open: isLibraryMenuOpen,
    onClose: () => setIsLibraryMenuOpen(false),
  })

  const handleOpenLibraryManagerFromMenu = (event: MouseEvent<HTMLButtonElement>) => {
    setIsLibraryMenuOpen(false)
    // On Android WebView the tap that closes this submenu still dispatches a
    // phantom native click; suppressing it keeps the modal mounted. The
    // modal itself also closes on pointerdown, so no timing hack is needed.
    beginPhantomClickSuppression(event.currentTarget)
    onOpenLibraryManager()
  }

  return (
    <div className="notia-footer" data-notia-prevent-menu-close>
      <button
        ref={triggerRef}
        type="button"
        className="notia-footer-library-trigger"
        aria-label={`Librería activa: ${name || 'ninguna'}. Cambiar de librería`}
        aria-haspopup="menu"
        aria-expanded={isLibraryMenuOpen}
        onClick={() => setIsLibraryMenuOpen((current) => !current)}
      >
        <span className="notia-footer-library-mark" aria-hidden="true">
          <Library size={13} strokeWidth={2} />
        </span>
        <span className="notia-footer-library-name">{name || 'Sin librería'}</span>
        <ChevronsUpDown size={14} strokeWidth={1.75} className="notia-footer-library-chevron" aria-hidden="true" />
      </button>
      {isLibraryMenuOpen ? (
        <div className="notia-library-menu" ref={panelRef} role="menu" aria-label="Librerías">
          <div className="notia-library-menu-list">
            {libraries.length > 0 ? (
              libraries.map((library) => {
                const isActive = library.id === activeLibraryId
                return (
                  <button
                    key={library.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={isActive}
                    className={`notia-library-item${isActive ? ' notia-library-item--active' : ''}`}
                    onClick={() => {
                      onSelectLibrary(library.id)
                      setIsLibraryMenuOpen(false)
                    }}
                  >
                    <span className="notia-library-item-name">{library.name}</span>
                    {isActive ? <Check size={14} strokeWidth={2} aria-hidden="true" /> : null}
                  </button>
                )
              })
            ) : (
              <div className="notia-library-empty">Sin librerías disponibles</div>
            )}
          </div>
          <button
            type="button"
            role="menuitem"
            className="notia-library-manage"
            onClick={handleOpenLibraryManagerFromMenu}
          >
            <BookOpen size={14} strokeWidth={1.75} />
            <span>Administrar librerías</span>
          </button>
        </div>
      ) : null}
    </div>
  )
}

export const WorkspaceFooter = memo(WorkspaceFooterComponent)
WorkspaceFooter.displayName = 'WorkspaceFooter'
