import {
  BookOpen,
  Folder,
  FolderOpen,
  FolderPlus,
  GitBranch,
  Lock,
  MessageSquare,
  ListChecks,
  PanelsTopLeft,
  PencilLine,
  Network,
  Search,
  X,
  Minus,
  Square,
  Mic,
  WalletCards,
} from 'lucide-react'
import type { NotiaIconAction } from '../types/notia'

export const EXPLORER_HEADER_ACTIONS: NotiaIconAction[] = [
  { id: 'layout', label: 'Toggle Sidebars', icon: PanelsTopLeft },
  { id: 'search', label: 'Search', icon: Search },
]

export const LEFT_RAIL_ACTIONS: NotiaIconAction[] = [
  { id: 'graph-view', label: 'Graph view', icon: GitBranch },
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'task-manager', label: 'Task manager', icon: ListChecks },
  { id: 'coldpass', label: 'ColdPass', icon: Lock },
  { id: 'meeting', label: 'Transcribir meeting', icon: Mic },
  { id: 'finance', label: 'Finanzas', icon: WalletCards },
]

export const TOP_TOOLBAR_ACTIONS: NotiaIconAction[] = [
  { id: 'new-note', label: 'New Note', icon: PencilLine },
  { id: 'new-mermaid', label: 'New Diagram', icon: Network },
  { id: 'new-folder', label: 'New Folder', icon: FolderPlus },
  { id: 'collapse-folders', label: 'Collapse Folders', icon: Folder },
  { id: 'expand-folders', label: 'Expand Folders', icon: FolderOpen },
]

export const TITLEBAR_LEFT_ACTIONS: NotiaIconAction[] = []

export const TITLEBAR_NAV_ACTIONS: NotiaIconAction[] = []

export const TITLEBAR_RIGHT_ACTIONS: NotiaIconAction[] = [
  { id: 'maximize', label: 'Maximize', icon: Square },
  { id: 'minimize', label: 'Minimize', icon: Minus },
  { id: 'close', label: 'Close', icon: X },
]

export const TAB_ICON = BookOpen
