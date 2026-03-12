import {
  ChevronDown,
  ChevronRight,
  Clock3,
  CornerDownRight,
  Edit2,
  Eye,
  FolderKanban,
  GripVertical,
  MessageCircle,
  MessageSquare,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Send,
  Settings,
  Square,
  Trash2,
  type LucideIcon,
} from 'lucide-react'

export const TASK_ICON_NAME = {
  chevronDown: 'chevronDown',
  chevronRight: 'chevronRight',
  clock: 'clock',
  comment: 'comment',
  commentBubble: 'commentBubble',
  cornerDownRight: 'cornerDownRight',
  dragHandle: 'dragHandle',
  edit: 'edit',
  folderKanban: 'folderKanban',
  eye: 'eye',
  pause: 'pause',
  pencil: 'pencil',
  play: 'play',
  plus: 'plus',
  refresh: 'refresh',
  reset: 'reset',
  send: 'send',
  settings: 'settings',
  stop: 'stop',
  trash: 'trash',
} as const

export type TaskIconName = (typeof TASK_ICON_NAME)[keyof typeof TASK_ICON_NAME]

const TASK_ICON_REGISTRY: Record<TaskIconName, LucideIcon> = {
  [TASK_ICON_NAME.chevronDown]: ChevronDown,
  [TASK_ICON_NAME.chevronRight]: ChevronRight,
  [TASK_ICON_NAME.clock]: Clock3,
  [TASK_ICON_NAME.comment]: MessageSquare,
  [TASK_ICON_NAME.commentBubble]: MessageCircle,
  [TASK_ICON_NAME.cornerDownRight]: CornerDownRight,
  [TASK_ICON_NAME.dragHandle]: GripVertical,
  [TASK_ICON_NAME.edit]: Edit2,
  [TASK_ICON_NAME.folderKanban]: FolderKanban,
  [TASK_ICON_NAME.eye]: Eye,
  [TASK_ICON_NAME.pause]: Pause,
  [TASK_ICON_NAME.pencil]: Pencil,
  [TASK_ICON_NAME.play]: Play,
  [TASK_ICON_NAME.plus]: Plus,
  [TASK_ICON_NAME.refresh]: RefreshCw,
  [TASK_ICON_NAME.reset]: RotateCcw,
  [TASK_ICON_NAME.send]: Send,
  [TASK_ICON_NAME.settings]: Settings,
  [TASK_ICON_NAME.stop]: Square,
  [TASK_ICON_NAME.trash]: Trash2,
}

const TASK_ICON_FALLBACK_TEXT: Record<TaskIconName, string> = {
  [TASK_ICON_NAME.chevronDown]: 'v',
  [TASK_ICON_NAME.chevronRight]: '>',
  [TASK_ICON_NAME.clock]: 'C',
  [TASK_ICON_NAME.comment]: 'M',
  [TASK_ICON_NAME.commentBubble]: 'M',
  [TASK_ICON_NAME.cornerDownRight]: 'L',
  [TASK_ICON_NAME.dragHandle]: '::',
  [TASK_ICON_NAME.edit]: 'E',
  [TASK_ICON_NAME.folderKanban]: 'F',
  [TASK_ICON_NAME.eye]: 'O',
  [TASK_ICON_NAME.pause]: '||',
  [TASK_ICON_NAME.pencil]: 'P',
  [TASK_ICON_NAME.play]: '>',
  [TASK_ICON_NAME.plus]: '+',
  [TASK_ICON_NAME.refresh]: 'R',
  [TASK_ICON_NAME.reset]: 'O',
  [TASK_ICON_NAME.send]: 'S',
  [TASK_ICON_NAME.settings]: 'S',
  [TASK_ICON_NAME.stop]: '[]',
  [TASK_ICON_NAME.trash]: 'X',
}

interface TaskManagerIconProps {
  name: TaskIconName
  size?: number
  strokeWidth?: number
  className?: string
}

export function TaskManagerIcon({
  name,
  size = 14,
  strokeWidth = 2,
  className,
}: TaskManagerIconProps) {
  const Icon = TASK_ICON_REGISTRY[name]
  const resolvedClassName = className ? `tareas-icon ${className}` : 'tareas-icon'

  if (!Icon) {
    return <span className="tareas-icon-fallback">{TASK_ICON_FALLBACK_TEXT[name] ?? '?'}</span>
  }

  return <Icon className={resolvedClassName} size={size} strokeWidth={strokeWidth} aria-hidden="true" />
}
