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
  children?: NotiaFileNode[]
}

export interface NotiaLibrary {
  id: string
  name: string
  path: string
  androidTreeUri?: string
}
