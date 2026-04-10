import { useEffect, useMemo, useState } from 'react'
import { Search, X } from 'lucide-react'
import { NotiaModalShell } from '../../NotiaModalShell'
import { NotiaButton } from '../../../common/NotiaButton'
import { useVirtualList } from '../../../../hooks/useVirtualList'
import type { NotiaLibrary } from '../../../../types/notia'
import {
  filterLibraryFileOptions,
  loadLibraryFileOptions,
  type ChatFileContextMode,
  type ChatLibraryFileOption,
} from '../../../../services/chat/chatAttachmentRuntime'

interface ChatLibraryFilesModalProps {
  open: boolean
  library: NotiaLibrary | null
  selectedPaths: string[]
  contextMode: ChatFileContextMode
  onClose: () => void
  onApply: (payload: {
    selectedPaths: string[]
    selectedOptions: ChatLibraryFileOption[]
    contextMode: ChatFileContextMode
  }) => void
}

const CHAT_LIBRARY_FILE_OPTION_HEIGHT = 60

export function ChatLibraryFilesModal({
  open,
  library,
  selectedPaths,
  contextMode,
  onClose,
  onApply,
}: ChatLibraryFilesModalProps) {
  const [query, setQuery] = useState('')
  const [options, setOptions] = useState<ChatLibraryFileOption[]>([])
  const [draftSelectedPaths, setDraftSelectedPaths] = useState<string[]>(selectedPaths)
  const [draftContextMode, setDraftContextMode] = useState<ChatFileContextMode>(contextMode)
  const [isLoading, setIsLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      return
    }

    setDraftSelectedPaths(selectedPaths)
    setDraftContextMode(contextMode)
    setQuery('')
  }, [contextMode, open, selectedPaths])

  useEffect(() => {
    if (!open || !library) {
      setOptions([])
      setIsLoading(false)
      return
    }

    let cancelled = false
    setIsLoading(true)
    setErrorMessage(null)

    void loadLibraryFileOptions(library)
      .then((nextOptions) => {
        if (!cancelled) {
          setOptions(nextOptions)
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setErrorMessage(
            error instanceof Error && error.message.trim()
              ? error.message
              : 'No se pudieron cargar los archivos de la librería.',
          )
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [library, open])

  const visibleOptions = useMemo(
    () => filterLibraryFileOptions(options, query),
    [options, query],
  )
  const { containerRef, scrollToIndex, totalSize, virtualItems } = useVirtualList({
    itemCount: visibleOptions.length,
    itemSize: CHAT_LIBRARY_FILE_OPTION_HEIGHT,
    overscan: 8,
  })

  useEffect(() => {
    if (!open) {
      return
    }

    scrollToIndex(0, 'start')
  }, [open, query, scrollToIndex])

  if (!open) {
    return null
  }

  return (
    <NotiaModalShell open={open} onClose={onClose} size="lg" panelClassName="notia-chat-files-modal">
      <div className="notia-chat-files-modal-header">
        <div>
          <h2>Archivos de la librería</h2>
          <p>Buscá por nombre, elegí uno o varios archivos y definí cómo enviarlos al modelo.</p>
        </div>
        <NotiaButton size="icon" variant="ghost" className="notia-settings-close" title="Cerrar" onClick={onClose}>
          <X size={16} />
        </NotiaButton>
      </div>

      <div className="notia-chat-files-modal-body">
        <div className="notia-chat-files-modal-toolbar">
          <label className="notia-chat-files-modal-search">
            <Search size={15} />
            <input
              type="text"
              value={query}
              placeholder="Buscar archivos por nombre..."
              onChange={(event) => {
                setQuery(event.target.value)
              }}
            />
          </label>

          <div className="notia-chat-files-context-toggle" role="group" aria-label="Modo de contexto para archivos">
            <button
              type="button"
              className={draftContextMode === 'direct' ? 'is-active' : ''}
              onClick={() => {
                setDraftContextMode('direct')
              }}
            >
              Directo
            </button>
            <button
              type="button"
              className={draftContextMode === 'index' ? 'is-active' : ''}
              onClick={() => {
                setDraftContextMode('index')
              }}
            >
              Index
            </button>
          </div>
        </div>

        <div className="notia-chat-files-modal-copy">
          <span>{draftSelectedPaths.length} archivo(s) seleccionado(s)</span>
          <span>{draftContextMode === 'index' ? 'Index usa LlamaIndex' : 'Directo envía el contenido completo'}</span>
        </div>

        <div ref={containerRef} className="notia-chat-files-modal-list" role="list">
          {isLoading ? (
            <div className="notia-chat-files-modal-empty">Cargando archivos de la librería...</div>
          ) : errorMessage ? (
            <div className="notia-chat-files-modal-empty">{errorMessage}</div>
          ) : visibleOptions.length > 0 ? (
            <div style={{ height: `${totalSize}px`, position: 'relative' }}>
              {virtualItems.map((virtualItem) => {
                const option = visibleOptions[virtualItem.index]
                if (!option) {
                  return null
                }

                const checked = draftSelectedPaths.includes(option.path)
                return (
                  <div
                    key={option.path}
                    style={{
                      position: 'absolute',
                      top: `${virtualItem.start}px`,
                      left: 0,
                      right: 0,
                      height: `${virtualItem.size}px`,
                    }}
                  >
                    <label
                      className="notia-chat-files-modal-item"
                      title={`${option.name}\n${option.relativePath}`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(event) => {
                          setDraftSelectedPaths((current) => {
                            if (event.target.checked) {
                              return current.includes(option.path) ? current : [...current, option.path]
                            }
                            return current.filter((path) => path !== option.path)
                          })
                        }}
                      />
                      <div>
                        <strong>{option.name}</strong>
                        <span>{option.relativePath}</span>
                      </div>
                    </label>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="notia-chat-files-modal-empty">
              {query.trim() ? 'No hay archivos que coincidan con esa búsqueda.' : 'No hay archivos disponibles en la librería.'}
            </div>
          )}
        </div>
      </div>

      <div className="notia-chat-files-modal-actions">
        <NotiaButton variant="secondary" onClick={onClose}>
          Cancelar
        </NotiaButton>
        <NotiaButton
          variant="primary"
          onClick={() => {
            onApply({
              selectedPaths: draftSelectedPaths,
              selectedOptions: options.filter((option) => draftSelectedPaths.includes(option.path)),
              contextMode: draftContextMode,
            })
          }}
          disabled={!library}
        >
          Aplicar
        </NotiaButton>
      </div>
    </NotiaModalShell>
  )
}
