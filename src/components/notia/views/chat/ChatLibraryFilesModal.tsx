import { useEffect, useMemo, useState } from 'react'
import { Search, X } from 'lucide-react'
import { NotiaModalShell } from '../../NotiaModalShell'
import { NotiaButton } from '../../../common/NotiaButton'
import { useVirtualList } from '../../../../hooks/useVirtualList'
import type { NotiaLibrary } from '../../../../types/notia'
import {
  filterLibraryFileOptions,
  loadLibraryFileOptions,
  loadLibraryFolderOptions,
  type ChatFileContextMode,
  type ChatLibraryFileOption,
} from '../../../../services/chat/chatAttachmentRuntime'

const CHAT_FILES_INDEX_MODE_DESCRIPTION =
  'La IA conoce los nombres y rutas de los archivos, pero no su contenido completo.'
const CHAT_FILES_DIRECT_MODE_DESCRIPTION = 'Se envía el contenido completo de cada archivo al modelo.'

const MODAL_COPY = {
  files: {
    title: 'Archivos de la librería',
    description: 'Buscá por nombre, elegí uno o varios archivos y definí cómo enviarlos al modelo.',
    placeholder: 'Buscar archivos por nombre...',
    selected: (count: number) => `${count} archivo(s) seleccionado(s)`,
    loading: 'Cargando archivos de la librería...',
    noMatch: 'No hay archivos que coincidan con esa búsqueda.',
    empty: 'No hay archivos disponibles en la librería.',
    error: 'No se pudieron cargar los archivos de la librería.',
  },
  folders: {
    title: 'Carpetas de la librería',
    description: 'Elegí una o varias carpetas: el chat usa todos sus archivos, subcarpetas incluidas.',
    placeholder: 'Buscar carpetas por nombre...',
    selected: (count: number) => `${count} carpeta(s) seleccionada(s)`,
    loading: 'Cargando carpetas de la librería...',
    noMatch: 'No hay carpetas que coincidan con esa búsqueda.',
    empty: 'La librería no tiene carpetas con archivos.',
    error: 'No se pudieron cargar las carpetas de la librería.',
  },
} as const

interface ChatLibraryFilesModalProps {
  /** Pick files (default) or folders of the library. */
  kind?: keyof typeof MODAL_COPY
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
  kind = 'files',
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
  const [needsDraftReset, setNeedsDraftReset] = useState(false)
  const copy = MODAL_COPY[kind]

  useEffect(() => {
    if (open) {
      setNeedsDraftReset(true)
    }
  }, [open])

  useEffect(() => {
    if (!needsDraftReset) {
      return
    }
    setNeedsDraftReset(false)
    setDraftSelectedPaths(selectedPaths)
    setDraftContextMode(contextMode)
    setQuery('')
  }, [contextMode, needsDraftReset, selectedPaths])

  // Loads the files each time the modal opens. The effect depends only on
  // `open` and `library`, so its own state updates never cancel the request.
  useEffect(() => {
    if (!open) {
      return
    }
    if (!library) {
      setOptions([])
      setIsLoading(false)
      return
    }

    let cancelled = false
    setIsLoading(true)
    setErrorMessage(null)

    const loadOptions = kind === 'folders' ? loadLibraryFolderOptions : loadLibraryFileOptions
    void loadOptions(library)
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
              : MODAL_COPY[kind].error,
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
  }, [kind, library, open])

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
          <h2>{copy.title}</h2>
          <p>{copy.description}</p>
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
              placeholder={copy.placeholder}
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
              title={CHAT_FILES_DIRECT_MODE_DESCRIPTION}
              aria-label={`Directo: ${CHAT_FILES_DIRECT_MODE_DESCRIPTION}`}
            >
              Directo
            </button>
            <button
              type="button"
              className={draftContextMode === 'index' ? 'is-active' : ''}
              onClick={() => {
                setDraftContextMode('index')
              }}
              title={CHAT_FILES_INDEX_MODE_DESCRIPTION}
              aria-label={`Index: ${CHAT_FILES_INDEX_MODE_DESCRIPTION}`}
            >
              Referencia
            </button>
          </div>
        </div>

        <div className="notia-chat-files-modal-copy">
          <span>{copy.selected(draftSelectedPaths.length)}</span>
          <span title={draftContextMode === 'index' ? CHAT_FILES_INDEX_MODE_DESCRIPTION : CHAT_FILES_DIRECT_MODE_DESCRIPTION}>
            {draftContextMode === 'index'
              ? 'Referencia: la IA conoce nombres y rutas, no el contenido completo'
              : 'Directo: se envía el contenido completo'}
          </span>
        </div>

        <div ref={containerRef} className="notia-chat-files-modal-list" role="list">
          {isLoading ? (
            <div className="notia-chat-files-modal-empty">{copy.loading}</div>
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
                        <span>
                          {option.relativePath}
                          {option.fileCount !== undefined ? ` · ${option.fileCount} archivo${option.fileCount === 1 ? '' : 's'}` : ''}
                        </span>
                      </div>
                    </label>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="notia-chat-files-modal-empty">
              {query.trim() ? copy.noMatch : copy.empty}
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
