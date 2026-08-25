import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, FileText, Folder, FolderOpen, GitGraph } from 'lucide-react'
import type { NotiaFileNode } from '../../types/notia'
import { useVirtualList } from '../../hooks/useVirtualList'
import { joinFileName, splitFileName } from '../../utils/files/splitFileName'

interface PendingCreation {
  id: string
  kind: 'folder' | 'note' | 'mermaid'
  initialName: string
  parentPath: string
}

interface FileTreeProps {
  nodes: NotiaFileNode[]
  rootPath: string | null
  isSearchActive: boolean
  searchMatchedFilePaths: ReadonlySet<string>
  onToggleFolder: (folderId: string) => void
  onOpenFile: (filePath: string) => void
  pendingCreation: PendingCreation | null
  onSubmitPendingCreation: (name: string) => void
  onCancelPendingCreation: () => void
  renamingPath: string | null
  onSubmitRename: (path: string, name: string) => void
  onCancelRename: () => void
  onNodeContextMenu: (node: NotiaFileNode, position: { x: number; y: number }) => void
  onEmptyContextMenu: (position: { x: number; y: number }) => void
  onMoveNode: (sourcePath: string, targetDirectoryPath: string) => void
  loadingFolderIds?: ReadonlySet<string>
}

interface TreeRowProps {
  node: NotiaFileNode
  level: number
  isSearchActive: boolean
  searchMatchedFilePaths: ReadonlySet<string>
  onToggleFolder: (folderId: string) => void
  onOpenFile: (filePath: string) => void
  renamingPath: string | null
  onSubmitRename: (path: string, name: string) => void
  onCancelRename: () => void
  onNodeContextMenu: (node: NotiaFileNode, position: { x: number; y: number }) => void
  draggingPath: string | null
  dropTargetFolderPath: string | null
  onDragStartNode: (path: string) => void
  onDragEndNode: () => void
  onDragOverFolder: (targetPath: string) => boolean
  onDropOnFolder: (targetPath: string) => void
  isLoading?: boolean
}

type VisibleTreeRow =
  | {
    kind: 'node'
    key: string
    level: number
    node: NotiaFileNode
  }
  | {
    kind: 'pending'
    key: string
    level: number
    pendingCreation: PendingCreation
  }

const TREE_ROW_HEIGHT = 27

const CREATION_EXTENSION_BY_KIND: Readonly<Record<Exclude<PendingCreation['kind'], 'folder'>, string>> = {
  note: '.md',
  mermaid: '.mmd',
}

function normalizePath(pathValue: string): string {
  return pathValue.replace(/\\/g, '/').replace(/\/+$/, '')
}

function isSameOrNestedPath(basePath: string, candidatePath: string): boolean {
  const normalizedBase = normalizePath(basePath)
  const normalizedCandidate = normalizePath(candidatePath)
  if (normalizedBase === normalizedCandidate) {
    return true
  }
  return normalizedCandidate.startsWith(`${normalizedBase}/`)
}

const TreeRow = memo(function TreeRow({
  node,
  level,
  isSearchActive,
  searchMatchedFilePaths,
  onToggleFolder,
  onOpenFile,
  renamingPath,
  onSubmitRename,
  onCancelRename,
  onNodeContextMenu,
  draggingPath,
  dropTargetFolderPath,
  onDragStartNode,
  onDragEndNode,
  onDragOverFolder,
  onDropOnFolder,
  isLoading: isLoading,
}: TreeRowProps) {
  const isFolder = node.type === 'folder'
  const hasChildren = Boolean(node.children?.length) || Boolean(node.hasChildren)
  const isExpanded = Boolean(node.expanded)
  const canToggle = isFolder && hasChildren
  const isLoadingFolder = Boolean(isLoading && isFolder && hasChildren && !node.children?.length)
  const canOpenFile = node.type === 'file' && Boolean(node.path)
  const isSearchMatch =
    isSearchActive &&
    node.type === 'file' &&
    typeof node.path === 'string' &&
    searchMatchedFilePaths.has(node.path)
  const isInteractive = canToggle || canOpenFile
  const isRenaming = Boolean(node.path && renamingPath === node.path)
  const inputRef = useRef<HTMLInputElement>(null)
  const nodePath = typeof node.path === 'string' ? node.path : null
  const isDragging = Boolean(nodePath && draggingPath === nodePath)
  const isDropTarget = Boolean(isFolder && nodePath && dropTargetFolderPath === nodePath)
  const { baseName, extension } = node.type === 'file'
    ? splitFileName(node.name)
    : { baseName: node.name, extension: '' }
  const [renameValue, setRenameValue] = useState(baseName)

  useEffect(() => {
    if (!isRenaming) {
      return
    }
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [isRenaming])

  useEffect(() => {
    setRenameValue(baseName)
  }, [baseName])

  const handleRowClick = () => {
    if (isRenaming) {
      return
    }
    if (!canToggle) {
      if (canOpenFile && node.path) {
        onOpenFile(node.path)
      }
      return
    }
    onToggleFolder(node.id)
  }

  const submitRename = () => {
    if (!node.path) {
      onCancelRename()
      return
    }
    const normalized = renameValue.trim()
    if (!normalized) {
      onCancelRename()
      return
    }
    onSubmitRename(node.path, joinFileName(normalized, extension))
  }

  return (
    <div
      data-tree-row="true"
      className={`notia-tree-row ${node.selected ? 'notia-tree-row--selected' : ''} ${isInteractive ? 'notia-tree-row--toggleable' : ''} ${isSearchMatch ? 'notia-tree-row--search-match' : ''} ${isDragging ? 'notia-tree-row--dragging' : ''} ${isDropTarget ? 'notia-tree-row--drop-target' : ''}`}
      style={{ paddingLeft: `${18 + level * 16}px` }}
      onClick={handleRowClick}
      draggable={Boolean(nodePath && !isRenaming)}
      role={isInteractive ? 'button' : undefined}
      tabIndex={isInteractive ? 0 : undefined}
      onDragStart={
        nodePath
          ? (event) => {
              event.dataTransfer.effectAllowed = 'move'
              event.dataTransfer.setData('text/plain', nodePath)
              onDragStartNode(nodePath)
            }
          : undefined
      }
      onDragEnd={onDragEndNode}
      onDragOver={
        isFolder && nodePath
          ? (event) => {
              if (!onDragOverFolder(nodePath)) {
                return
              }

              event.preventDefault()
              event.dataTransfer.dropEffect = 'move'
            }
          : undefined
      }
      onDrop={
        isFolder && nodePath
          ? (event) => {
              event.preventDefault()
              onDropOnFolder(nodePath)
            }
          : undefined
      }
      onKeyDown={
        isInteractive
          ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                handleRowClick()
              }
            }
          : undefined
      }
      onContextMenu={(event) => {
        event.preventDefault()
        onNodeContextMenu(node, { x: event.clientX, y: event.clientY })
      }}
    >
      {isFolder ? (
         <>
          {isLoadingFolder ? (
            <span className="notia-tree-chevron notia-tree-chevron--loading" title="Cargando..." />
          ) : hasChildren && isExpanded ? (
            <ChevronDown size={13} className="notia-tree-chevron" />
          ) : (
            <ChevronRight size={13} className="notia-tree-chevron" />
          )}
          {isExpanded ? (
            <FolderOpen size={12} className="notia-tree-folder notia-tree-folder--open" />
          ) : (
            <Folder size={12} className="notia-tree-folder" />
          )}
        </>
      ) : node.name.endsWith('.mmd') ? (
        <GitGraph size={12} className="notia-tree-file" />
      ) : (
        <FileText size={12} className="notia-tree-file" />
      )}
      {isRenaming ? (
        <>
          <input
            ref={inputRef}
            className="notia-tree-inline-input"
            aria-label={isFolder ? 'Nombre de la carpeta' : 'Nombre del archivo'}
            value={renameValue}
            onChange={(event) => setRenameValue(event.target.value)}
            onBlur={submitRename}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                submitRename()
              }
              if (event.key === 'Escape') {
                event.preventDefault()
                onCancelRename()
              }
            }}
          />
          {extension ? (
            <span className="notia-tree-extension" title={`Formato ${extension}`}>
              {extension}
            </span>
          ) : null}
        </>
      ) : (
        <>
          <span className="notia-tree-label">{baseName}</span>
          {extension ? (
            <span className="notia-tree-extension" title={`Formato ${extension}`}>
              {extension}
            </span>
          ) : null}
        </>
      )}
    </div>
  )
})

interface PendingCreationRowProps {
  pendingCreation: PendingCreation
  onSubmit: (name: string) => void
  onCancel: () => void
  level?: number
}

function PendingCreationRow({ pendingCreation, onSubmit, onCancel, level = 0 }: PendingCreationRowProps) {
  const [value, setValue] = useState(pendingCreation.initialName)
  const inputRef = useRef<HTMLInputElement>(null)
  const extension = pendingCreation.kind === 'folder'
    ? ''
    : CREATION_EXTENSION_BY_KIND[pendingCreation.kind]

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [pendingCreation.id])

  const submitValue = () => {
    const normalized = value.trim()
    if (!normalized) {
      onCancel()
      return
    }
    onSubmit(normalized)
  }

  return (
    <div data-tree-row="true" className="notia-tree-row" style={{ paddingLeft: `${18 + level * 16}px` }}>
      {pendingCreation.kind === 'folder' ? (
        <Folder size={12} className="notia-tree-file" />
      ) : pendingCreation.kind === 'mermaid' ? (
        <GitGraph size={12} className="notia-tree-file" />
      ) : (
        <FileText size={12} className="notia-tree-file" />
      )}
      <input
        ref={inputRef}
        className="notia-tree-inline-input"
        aria-label={pendingCreation.kind === 'folder' ? 'Nombre de la carpeta' : 'Nombre del archivo'}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onBlur={submitValue}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            submitValue()
          }
          if (event.key === 'Escape') {
            event.preventDefault()
            onCancel()
          }
        }}
      />
      {extension ? (
        <span className="notia-tree-extension" title={`Formato ${extension}`}>
          {extension}
        </span>
      ) : null}
    </div>
  )
}

function buildVisibleTreeRows(
  nodes: NotiaFileNode[],
  pendingCreation: PendingCreation | null,
  rootPath: string | null,
): VisibleTreeRow[] {
  const rows: VisibleTreeRow[] = []

  if (pendingCreation && pendingCreation.parentPath === rootPath) {
    rows.push({
      kind: 'pending',
      key: pendingCreation.id,
      level: 0,
      pendingCreation,
    })
  }

  const visit = (currentNodes: NotiaFileNode[], level: number) => {
    for (const node of currentNodes) {
      rows.push({
        kind: 'node',
        key: node.id,
        level,
        node,
      })

      if (node.type !== 'folder' || !node.expanded) {
        continue
      }

      if (pendingCreation && node.path === pendingCreation.parentPath) {
        rows.push({
          kind: 'pending',
          key: pendingCreation.id,
          level: level + 1,
          pendingCreation,
        })
      }

      if (node.children && node.children.length > 0) {
        visit(node.children, level + 1)
      }
    }
  }

  visit(nodes, 0)
  return rows
}

function FileTreeComponent({
  nodes,
  rootPath,
  isSearchActive,
  searchMatchedFilePaths,
  onToggleFolder,
  onOpenFile,
  pendingCreation,
  onSubmitPendingCreation,
  onCancelPendingCreation,
  renamingPath,
  onSubmitRename,
  onCancelRename,
  onNodeContextMenu,
  onEmptyContextMenu,
  onMoveNode,
  loadingFolderIds,
}: FileTreeProps) {
  const [draggingEntry, setDraggingEntry] = useState<{ path: string } | null>(null)
  const [dropTargetFolderPath, setDropTargetFolderPath] = useState<string | null>(null)
  const visibleRows = useMemo(
    () => buildVisibleTreeRows(nodes, pendingCreation, rootPath),
    [nodes, pendingCreation, rootPath],
  )
  const { containerRef, scrollToIndex, totalSize, virtualItems } = useVirtualList({
    itemCount: visibleRows.length,
    itemSize: TREE_ROW_HEIGHT,
    overscan: 10,
  })

  const handleDragStartNode = useCallback((path: string) => {
    setDraggingEntry({ path })
  }, [])

  const handleDragEndNode = useCallback(() => {
    setDraggingEntry(null)
    setDropTargetFolderPath(null)
  }, [])

  const handleDragOverFolder = useCallback((targetPath: string): boolean => {
    if (!draggingEntry) {
      return false
    }

    if (isSameOrNestedPath(draggingEntry.path, targetPath)) {
      setDropTargetFolderPath(null)
      return false
    }

    setDropTargetFolderPath(targetPath)
    return true
  }, [draggingEntry])

  const handleDropOnFolder = useCallback((targetPath: string) => {
    if (!draggingEntry) {
      return
    }

    const sourcePath = draggingEntry.path
    setDraggingEntry(null)
    setDropTargetFolderPath(null)

    if (isSameOrNestedPath(sourcePath, targetPath)) {
      return
    }

    onMoveNode(sourcePath, targetPath)
  }, [draggingEntry, onMoveNode])

  useEffect(() => {
    if (!pendingCreation) {
      return
    }

    const pendingIndex = visibleRows.findIndex((row) => row.kind === 'pending' && row.key === pendingCreation.id)
    if (pendingIndex >= 0) {
      scrollToIndex(pendingIndex, 'nearest')
    }
  }, [pendingCreation, scrollToIndex, visibleRows])

  useEffect(() => {
    if (!renamingPath) {
      return
    }

    const renamedRowIndex = visibleRows.findIndex((row) => (
      row.kind === 'node' && row.node.path === renamingPath
    ))
    if (renamedRowIndex >= 0) {
      scrollToIndex(renamedRowIndex, 'nearest')
    }
  }, [renamingPath, scrollToIndex, visibleRows])

  if (visibleRows.length === 0) {
    return <div className="notia-tree-empty">No hay archivos para mostrar.</div>
  }

  return (
    <div
      ref={containerRef}
      className="notia-tree-scroll"
      onContextMenu={(event) => {
        const target = event.target instanceof HTMLElement ? event.target : null
        if (target?.closest('[data-tree-row="true"]')) {
          return
        }

        event.preventDefault()
        onEmptyContextMenu({ x: event.clientX, y: event.clientY })
      }}
    >
      <div style={{ height: `${totalSize}px`, position: 'relative' }}>
        {virtualItems.map((virtualItem) => {
          const row = visibleRows[virtualItem.index]
          if (!row) {
            return null
          }

          return (
            <div
              key={row.key}
              style={{
                position: 'absolute',
                top: `${virtualItem.start}px`,
                left: 0,
                right: 0,
                height: `${virtualItem.size}px`,
              }}
            >
              {row.kind === 'pending' ? (
                <PendingCreationRow
                  pendingCreation={row.pendingCreation}
                  onSubmit={onSubmitPendingCreation}
                  onCancel={onCancelPendingCreation}
                  level={row.level}
                />
              ) : (
                <TreeRow
                  node={row.node}
                  level={row.level}
                  isSearchActive={isSearchActive}
                  searchMatchedFilePaths={searchMatchedFilePaths}
                  onToggleFolder={onToggleFolder}
                  onOpenFile={onOpenFile}
                  renamingPath={renamingPath}
                  onSubmitRename={onSubmitRename}
                  onCancelRename={onCancelRename}
                  onNodeContextMenu={onNodeContextMenu}
                  draggingPath={draggingEntry?.path ?? null}
                  dropTargetFolderPath={dropTargetFolderPath}
                  onDragStartNode={handleDragStartNode}
                  onDragEndNode={handleDragEndNode}
                  onDragOverFolder={handleDragOverFolder}
                  onDropOnFolder={handleDropOnFolder}
                  isLoading={loadingFolderIds?.has(row.node.id) ?? false}
                />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export const FileTree = memo(FileTreeComponent)
