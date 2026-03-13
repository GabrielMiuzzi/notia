import { memo, useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, FileText, Folder, FolderOpen } from 'lucide-react'
import type { NotiaFileNode } from '../../types/notia'

interface PendingCreation {
  id: string
  kind: 'folder' | 'note' | 'inkdoc'
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
}

interface TreeRowProps {
  node: NotiaFileNode
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
  draggingPath: string | null
  dropTargetFolderPath: string | null
  onDragStartNode: (path: string) => void
  onDragEndNode: () => void
  onDragOverFolder: (targetPath: string) => boolean
  onDropOnFolder: (targetPath: string) => void
  level?: number
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

function TreeRow({
  node,
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
  draggingPath,
  dropTargetFolderPath,
  onDragStartNode,
  onDragEndNode,
  onDragOverFolder,
  onDropOnFolder,
  level = 0,
}: TreeRowProps) {
  const isFolder = node.type === 'folder'
  const hasChildren = Boolean(node.children?.length)
  const isExpanded = Boolean(node.expanded)
  const canToggle = isFolder && hasChildren
  const canOpenFile = node.type === 'file' && Boolean(node.path)
  const isSearchMatch =
    isSearchActive &&
    node.type === 'file' &&
    typeof node.path === 'string' &&
    searchMatchedFilePaths.has(node.path)
  const isInteractive = canToggle || canOpenFile
  const isRenaming = Boolean(node.path && renamingPath === node.path)
  const hasPendingInside =
    Boolean(pendingCreation) &&
    node.type === 'folder' &&
    node.path === pendingCreation?.parentPath
  const inputRef = useRef<HTMLInputElement>(null)
  const nodePath = typeof node.path === 'string' ? node.path : null
  const isDragging = Boolean(nodePath && draggingPath === nodePath)
  const isDropTarget = Boolean(isFolder && nodePath && dropTargetFolderPath === nodePath)
  const [renameValue, setRenameValue] = useState(
    node.type === 'file' ? node.name.replace(/\.(md|inkdoc)$/i, '') : node.name,
  )

  useEffect(() => {
    if (!isRenaming) {
      return
    }
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [isRenaming])

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
    onSubmitRename(node.path, normalized)
  }

  return (
    <div>
      <div
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
            {hasChildren && isExpanded ? (
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
        ) : (
          <FileText size={12} className="notia-tree-file" />
        )}
        {isRenaming ? (
          <input
            ref={inputRef}
            className="notia-tree-inline-input"
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
        ) : (
          <span className="notia-tree-label">{node.name}</span>
        )}
      </div>
      {isFolder && isExpanded ? (
        <div>
          {hasPendingInside && pendingCreation ? (
            <PendingCreationRow
              pendingCreation={pendingCreation}
              onSubmit={onSubmitPendingCreation}
              onCancel={onCancelPendingCreation}
              level={level + 1}
            />
          ) : null}
          {node.children!.map((child) => (
            <TreeRow
              key={child.id}
              node={child}
              isSearchActive={isSearchActive}
              searchMatchedFilePaths={searchMatchedFilePaths}
              onToggleFolder={onToggleFolder}
              onOpenFile={onOpenFile}
              pendingCreation={pendingCreation}
              onSubmitPendingCreation={onSubmitPendingCreation}
              onCancelPendingCreation={onCancelPendingCreation}
              renamingPath={renamingPath}
              onSubmitRename={onSubmitRename}
              onCancelRename={onCancelRename}
              onNodeContextMenu={onNodeContextMenu}
              draggingPath={draggingPath}
              dropTargetFolderPath={dropTargetFolderPath}
              onDragStartNode={onDragStartNode}
              onDragEndNode={onDragEndNode}
              onDragOverFolder={onDragOverFolder}
              onDropOnFolder={onDropOnFolder}
              level={level + 1}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

interface PendingCreationRowProps {
  pendingCreation: PendingCreation
  onSubmit: (name: string) => void
  onCancel: () => void
  level?: number
}

function PendingCreationRow({ pendingCreation, onSubmit, onCancel, level = 0 }: PendingCreationRowProps) {
  const [value, setValue] = useState(pendingCreation.initialName)
  const inputRef = useRef<HTMLInputElement>(null)

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
    <div className="notia-tree-row" style={{ paddingLeft: `${18 + level * 16}px` }}>
      {pendingCreation.kind === 'folder' ? (
        <Folder size={12} className="notia-tree-file" />
      ) : (
        <FileText size={12} className="notia-tree-file" />
      )}
      <input
        ref={inputRef}
        className="notia-tree-inline-input"
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
    </div>
  )
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
}: FileTreeProps) {
  const [draggingEntry, setDraggingEntry] = useState<{ path: string } | null>(null)
  const [dropTargetFolderPath, setDropTargetFolderPath] = useState<string | null>(null)

  const handleDragStartNode = (path: string) => {
    setDraggingEntry({ path })
  }

  const handleDragEndNode = () => {
    setDraggingEntry(null)
    setDropTargetFolderPath(null)
  }

  const handleDragOverFolder = (targetPath: string): boolean => {
    if (!draggingEntry) {
      return false
    }

    if (isSameOrNestedPath(draggingEntry.path, targetPath)) {
      setDropTargetFolderPath(null)
      return false
    }

    setDropTargetFolderPath(targetPath)
    return true
  }

  const handleDropOnFolder = (targetPath: string) => {
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
  }

  if (nodes.length === 0 && !pendingCreation) {
    return <div className="notia-tree-empty">No hay archivos para mostrar.</div>
  }

  return (
    <div
      className="notia-tree-scroll"
      onContextMenu={(event) => {
        if (event.target === event.currentTarget) {
          event.preventDefault()
          onEmptyContextMenu({ x: event.clientX, y: event.clientY })
        }
      }}
    >
      {pendingCreation && pendingCreation.parentPath === rootPath ? (
        <PendingCreationRow
          pendingCreation={pendingCreation}
          onSubmit={onSubmitPendingCreation}
          onCancel={onCancelPendingCreation}
          level={0}
        />
      ) : null}
      {nodes.map((node) => (
        <TreeRow
          key={node.id}
          node={node}
          isSearchActive={isSearchActive}
          searchMatchedFilePaths={searchMatchedFilePaths}
          onToggleFolder={onToggleFolder}
          onOpenFile={onOpenFile}
          pendingCreation={pendingCreation}
          onSubmitPendingCreation={onSubmitPendingCreation}
          onCancelPendingCreation={onCancelPendingCreation}
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
        />
      ))}
    </div>
  )
}

export const FileTree = memo(FileTreeComponent)
