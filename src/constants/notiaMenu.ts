import {
  ChevronsDownUp,
  ChevronsUpDown,
  FileText,
  FolderPlus,
  GitBranch,
  Lock,
  MessageSquare,
  ListChecks,
  PencilLine,
  Network,
  X,
  Minus,
  Square,
  Mic,
  WalletCards,
  CalendarCheck,
  CalendarClock,
  UsersRound,
} from 'lucide-react'
import type { NotiaIconAction } from '../types/notia'

/** Rail modules, in groups separated by a divider. */
export const LEFT_RAIL_GROUPS: NotiaIconAction[][] = [
  [
    { id: 'graph-view', label: 'Vista de grafo', icon: GitBranch },
    { id: 'chat', label: 'Chat', icon: MessageSquare },
    { id: 'task-manager', label: 'Task Manager', icon: ListChecks },
  ],
  [
    { id: 'coldpass', label: 'ColdPass', icon: Lock },
    { id: 'meeting', label: 'Transcribir meeting', icon: Mic },
    { id: 'finance', label: 'Finanzas', icon: WalletCards },
  ],
  [
    { id: 'agenda', label: 'Agenda', icon: CalendarClock },
    { id: 'multichat', label: 'Multichat', icon: UsersRound },
    { id: 'routine', label: 'Rutina', icon: CalendarCheck },
  ],
]

/** Actions in the explorer header. */
export const TOP_TOOLBAR_ACTIONS: NotiaIconAction[] = [
  { id: 'new-note', label: 'Nueva nota', icon: PencilLine },
  { id: 'new-mermaid', label: 'Nuevo diagrama', icon: Network },
  { id: 'new-folder', label: 'Nueva carpeta', icon: FolderPlus },
  { id: 'collapse-folders', label: 'Colapsar carpetas', icon: ChevronsDownUp },
  { id: 'expand-folders', label: 'Expandir carpetas', icon: ChevronsUpDown },
]

export const TITLEBAR_LEFT_ACTIONS: NotiaIconAction[] = []

export const TITLEBAR_NAV_ACTIONS: NotiaIconAction[] = []

export const TITLEBAR_RIGHT_ACTIONS: NotiaIconAction[] = [
  { id: 'minimize', label: 'Minimizar', icon: Minus },
  { id: 'maximize', label: 'Maximizar', icon: Square },
  { id: 'close', label: 'Cerrar ventana', icon: X },
]

export const TAB_ICON = FileText
