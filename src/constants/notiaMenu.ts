import {
  BookOpen,
  FolderPlus,
  GitBranch,
  PanelsTopLeft,
  PencilLine,
  Search,
  X,
  Minus,
  Square,
} from 'lucide-react'
import type { NotiaIconAction } from '../types/notia'

export const EXPLORER_HEADER_ACTIONS: NotiaIconAction[] = [
  { id: 'layout', label: 'Toggle Sidebars', icon: PanelsTopLeft },
  { id: 'search', label: 'Search', icon: Search },
]

export const LEFT_RAIL_ACTIONS: NotiaIconAction[] = [
  { id: 'graph-view', label: 'Graph view', icon: GitBranch },
]

export const TOP_TOOLBAR_ACTIONS: NotiaIconAction[] = [
  { id: 'new-note', label: 'New Note', icon: PencilLine },
  { id: 'new-folder', label: 'New Folder', icon: FolderPlus },
]

export const TITLEBAR_LEFT_ACTIONS: NotiaIconAction[] = []

export const TITLEBAR_NAV_ACTIONS: NotiaIconAction[] = []

export const TITLEBAR_RIGHT_ACTIONS: NotiaIconAction[] = [
  { id: 'maximize', label: 'Maximize', icon: Square },
  { id: 'minimize', label: 'Minimize', icon: Minus },
  { id: 'close', label: 'Close', icon: X },
]

export const TAB_ICON = BookOpen
