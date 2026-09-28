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
  House,
} from 'lucide-react'
import type { NotiaIconAction } from '../types/notia'
import { MuninIcon } from '../components/notia/icons/MuninIcon'

/** Home, first in the rail and apart from the modules. */
export const HOME_RAIL_ACTION: NotiaIconAction = { id: 'home', label: 'Inicio', icon: House }

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
    { id: 'routine', label: 'Rutina', icon: CalendarCheck },
    { id: 'ai-actions', label: 'Acciones IA', icon: MuninIcon },
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
