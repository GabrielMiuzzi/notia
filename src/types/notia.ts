import type { LucideIcon } from 'lucide-react'

export interface NotiaIconAction {
  id: string
  label: string
  icon: LucideIcon
  active?: boolean
}

export interface NotiaFileNode {
  id: string
  name: string
  path?: string
  type: 'folder' | 'file'
  expanded?: boolean
  selected?: boolean
  hasChildren?: boolean
  children?: NotiaFileNode[]
  createdAt?: number
  modifiedAt?: number
}

export interface NotiaLibrary {
  id: string
  name: string
  path: string
  androidTreeUri?: string
}

/** A flat file entry returned by readLibraryFlatFileList. Unlike NotiaFileNode,
 *  this has no nesting — just the path, type, and name for every file/folder
 *  in the tree. Used by search index and graph engine which need the complete
 *  file list regardless of the lazy-loaded tree state. */
export interface NotiaFlatFileEntry {
  path: string
  type: 'folder' | 'file'
  name: string
}
