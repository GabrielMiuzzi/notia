import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronsLeft, FolderPlus, PencilLine, Search } from 'lucide-react'
import { FileTree } from '../../../../components/notia/FileTree'
import { FileTreeContextMenu } from '../../../../components/notia/FileTreeContextMenu'
import { useConfirmationEngine } from '../../../../context/confirmation/useConfirmationEngine'
import { applySearchMatchesToTree } from '../../../../engines/tree/applySearchMatchesToTree'
import { callBackend } from '../../../../services/transport'
import type { NotiaFileNode } from '../../../../types/notia'
import { getParentDirectory, joinParentPath } from '../../../../components/notia/hooks/useTabManager'
import { PUBLISHED_VAULT_ALIAS } from '../../hooks/usePublishedTicketTabs'
import { subscribeTaskManagerPublicationChanges } from '../../services/taskManagerPublicationClient'

/*
 * The explorer of the published page: the notes of the published boards'
 * contexts, as Rust lists them (`library_read_directory` of the
 * publication). The page keeps which folders are open and what is being
 * created or renamed; every change goes to Rust, which creates notes with
 * the board's context and refuses what leaves the published contexts.
 */

interface PendingCreation {
  id: string
  kind: 'folder' | 'note'
  initialName: string
  parentPath: string
}

interface ContextMenuState {
  x: number
  y: number
  node: NotiaFileNode | null
}

export interface PublishedExplorerProps {
  libraryId: string
  /** Context of the active board: what a new note takes. */
  newNoteContext: string
  activeBoard: string
  onOpenNote: (path: string) => void
  /** A note renamed or moved: its tab follows it. */
  onEntryRenamed: (from: string, to: string) => void
  onEntryDeleted: (path: string) => void
  /** The library changed: the graph reads it again. */
  onLibraryChanged: () => void
  onError: (message: string) => void
  /** «Ocultar explorador» of its header. */
  onHide: () => void
}

interface MutationResult {
  ok: boolean
  error?: string
}

function fold(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

function withExpansion(nodes: NotiaFileNode[], expanded: ReadonlySet<string>): NotiaFileNode[] {
  return nodes.map((node) => (node.type === 'folder'
    ? { ...node, expanded: expanded.has(node.id), children: withExpansion(node.children ?? [], expanded) }
    : node))
}


function filePaths(nodes: NotiaFileNode[]): string[] {
  return nodes.flatMap((node) => (node.type === 'folder' ? filePaths(node.children ?? []) : node.path ? [node.path] : []))
}

export function PublishedExplorer({
  libraryId,
  newNoteContext,
  activeBoard,
  onOpenNote,
  onEntryRenamed,
  onEntryDeleted,
  onLibraryChanged,
  onError,
  onHide,
}: PublishedExplorerProps) {
  const [nodes, setNodes] = useState<NotiaFileNode[]>([])
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const [query, setQuery] = useState('')
  const [pendingCreation, setPendingCreation] = useState<PendingCreation | null>(null)
  const [renamingPath, setRenamingPath] = useState<string | null>(null)
  const [menu, setMenu] = useState<ContextMenuState | null>(null)
  const { confirm } = useConfirmationEngine()
  const loadIdRef = useRef(0)

  const load = useCallback(async () => {
    const loadId = ++loadIdRef.current
    try {
      const tree = await callBackend<NotiaFileNode[]>('library_read_directory', { payload: { libraryId, path: PUBLISHED_VAULT_ALIAS } })
      if (loadId === loadIdRef.current) setNodes(tree)
    } catch {
      if (loadId === loadIdRef.current) onError('No se pudieron leer las notas de la biblioteca.')
    }
  }, [libraryId, onError])

  useEffect(() => {
    void load()
  }, [load])

  // Changes of the host or of other guests: the tree reads again.
  useEffect(() => subscribeTaskManagerPublicationChanges((change) => {
    if (change.type === 'changed' || change.type === 'resync-required') void load()
  }), [load])

  const changed = useCallback(async () => {
    await load()
    onLibraryChanged()
  }, [load, onLibraryChanged])

  const mutate = useCallback(async (payload: Record<string, unknown>, failure: string): Promise<boolean> => {
    try {
      const result = await callBackend<MutationResult>('library_mutate_entry', {
        payload: { libraryId, activeBoard, ...payload },
      })
      if (!result.ok) {
        onError(result.error ?? failure)
        return false
      }
      await changed()
      return true
    } catch (error) {
      onError(error instanceof Error && error.message ? error.message : failure)
      return false
    }
  }, [activeBoard, changed, libraryId, onError])

  const toggleFolder = useCallback((folderId: string) => {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(folderId)) next.delete(folderId)
      else next.add(folderId)
      return next
    })
  }, [])

  const startCreation = useCallback((kind: PendingCreation['kind'], parentPath: string) => {
    setRenamingPath(null)
    if (parentPath !== PUBLISHED_VAULT_ALIAS) setExpanded((current) => new Set(current).add(parentPath))
    setPendingCreation({ id: `${kind}-${Date.now()}`, kind, initialName: '', parentPath })
  }, [])

  const submitCreation = useCallback(async (name: string) => {
    const creation = pendingCreation
    setPendingCreation(null)
    if (!creation || !name.trim()) return
    await mutate(
      { action: 'create', path: creation.parentPath, name: name.trim(), kind: creation.kind, contexto: newNoteContext },
      'No se pudo crear.',
    )
  }, [mutate, newNoteContext, pendingCreation])

  const submitRename = useCallback(async (path: string, name: string) => {
    setRenamingPath(null)
    const trimmed = name.trim()
    if (!trimmed) return
    const target = joinParentPath(getParentDirectory(path), path, trimmed)
    if (target === path) return
    if (await mutate({ action: 'rename', path, name: trimmed }, 'No se pudo renombrar.')) onEntryRenamed(path, target)
  }, [mutate, onEntryRenamed])

  const remove = useCallback(async (node: NotiaFileNode) => {
    if (!node.path) return
    const accepted = await confirm({
      title: node.type === 'folder' ? 'Eliminar carpeta' : 'Eliminar nota',
      message: `¿Eliminar «${node.name}»? Esta acción no se puede deshacer.`,
      confirmLabel: 'Eliminar',
      cancelLabel: 'Cancelar',
      tone: 'danger',
    })
    if (!accepted) return
    if (await mutate({ action: 'delete', path: node.path }, 'No se pudo eliminar.')) onEntryDeleted(node.path)
  }, [confirm, mutate, onEntryDeleted])

  const moveNode = useCallback(async (sourcePath: string, targetDirectoryPath: string) => {
    const name = sourcePath.split('/').pop() ?? sourcePath
    const target = `${targetDirectoryPath}/${name}`
    if (await mutate({ action: 'paste', path: targetDirectoryPath, sourcePath, mode: 'move' }, 'No se pudo mover.')) {
      onEntryRenamed(sourcePath, target)
    }
  }, [mutate, onEntryRenamed])

  const menuItems = useMemo(() => {
    if (!menu) return []
    if (!menu.node) return [{ id: 'new-note', label: 'Nueva nota' }, { id: 'new-folder', label: 'Nueva carpeta' }]
    if (menu.node.type === 'folder') {
      return [
        { id: 'new-note', label: 'Nueva nota' },
        { id: 'new-folder', label: 'Nueva carpeta' },
        { id: 'rename', label: 'Renombrar' },
        { id: 'delete', label: 'Eliminar', danger: true },
      ]
    }
    return [{ id: 'open', label: 'Abrir' }, { id: 'rename', label: 'Renombrar' }, { id: 'delete', label: 'Eliminar', danger: true }]
  }, [menu])

  const runMenuAction = useCallback((id: string) => {
    const node = menu?.node ?? null
    setMenu(null)
    const parent = node?.type === 'folder' ? node.path ?? PUBLISHED_VAULT_ALIAS : node?.path ? getParentDirectory(node.path) : PUBLISHED_VAULT_ALIAS
    switch (id) {
      case 'new-note': startCreation('note', parent); break
      case 'new-folder': startCreation('folder', parent); break
      case 'open': if (node?.path) onOpenNote(node.path); break
      case 'rename': if (node?.path) { setPendingCreation(null); setRenamingPath(node.path) } break
      case 'delete': if (node) void remove(node); break
      default: break
    }
  }, [menu, onOpenNote, remove, startCreation])

  const isSearchActive = query.trim().length > 0
  const matched = useMemo(() => {
    if (!isSearchActive) return new Set<string>()
    const needle = fold(query.trim())
    return new Set(filePaths(nodes).filter((path) => fold(path.slice(PUBLISHED_VAULT_ALIAS.length + 1)).includes(needle)))
  }, [isSearchActive, nodes, query])
  const treeNodes = useMemo(
    () => applySearchMatchesToTree(withExpansion(nodes, expanded), matched, isSearchActive),
    [expanded, isSearchActive, matched, nodes],
  )
  const noNotes = nodes.length === 0

  return (
    <div className="notia-panel" data-notia-prevent-menu-close>
      <div className="notia-panel-header">
        <span className="notia-panel-title">Explorador</span>
        <div className="notia-panel-actions">
          <button type="button" className="notia-panel-action" aria-label="Nueva nota" title="Nueva nota" onClick={() => startCreation('note', PUBLISHED_VAULT_ALIAS)}>
            <PencilLine size={16} strokeWidth={1.75} />
          </button>
          <button type="button" className="notia-panel-action" aria-label="Nueva carpeta" title="Nueva carpeta" onClick={() => startCreation('folder', PUBLISHED_VAULT_ALIAS)}>
            <FolderPlus size={16} strokeWidth={1.75} />
          </button>
          <button type="button" className="notia-panel-action" aria-label="Ocultar explorador" title="Ocultar explorador" onClick={onHide}>
            <ChevronsLeft size={16} strokeWidth={1.9} />
          </button>
        </div>
      </div>
      <div className="notia-explorer-search-block">
        <label className="notia-explorer-search">
          <Search size={15} strokeWidth={1.75} aria-hidden="true" />
          <input
            type="search"
            value={query}
            placeholder="Buscar notas"
            aria-label="Buscar notas por nombre"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && isSearchActive) {
                event.preventDefault()
                setQuery('')
              }
            }}
          />
        </label>
        {isSearchActive ? (
          <div className="notia-explorer-search-meta" role="status" aria-live="polite">
            {`${matched.size} coincidencia${matched.size === 1 ? '' : 's'}`}
          </div>
        ) : null}
      </div>
      {noNotes && !pendingCreation ? (
        <p className="notia-published-explorer-empty">Todavía no hay notas con el contexto de este tablero. Creá una con «Nueva nota».</p>
      ) : null}
      <FileTree
        nodes={treeNodes}
        rootPath={PUBLISHED_VAULT_ALIAS}
        isSearchActive={isSearchActive}
        searchMatchedFilePaths={matched}
        onToggleFolder={toggleFolder}
        onOpenFile={onOpenNote}
        pendingCreation={pendingCreation}
        onSubmitPendingCreation={(name) => void submitCreation(name)}
        onCancelPendingCreation={() => setPendingCreation(null)}
        renamingPath={renamingPath}
        onSubmitRename={(path, name) => void submitRename(path, name)}
        onCancelRename={() => setRenamingPath(null)}
        onNodeContextMenu={(node, position) => setMenu({ ...position, node })}
        onEmptyContextMenu={(position) => setMenu({ ...position, node: null })}
        onMoveNode={(source, target) => void moveNode(source, target)}
      />
      <FileTreeContextMenu
        open={Boolean(menu)}
        position={{ x: menu?.x ?? 0, y: menu?.y ?? 0 }}
        items={menuItems}
        onAction={runMenuAction}
        onClose={() => setMenu(null)}
      />
    </div>
  )
}
