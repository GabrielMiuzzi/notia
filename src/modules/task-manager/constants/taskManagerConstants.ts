export const TASKS_ROOT_FOLDER = 'task-mannager'
export const FINISHED_TASKS_FOLDER = `${TASKS_ROOT_FOLDER}/finished`
export const FINISHED_SUBTASKS_FOLDER = `${FINISHED_TASKS_FOLDER}/subTasks`
export const CANCELLED_TASKS_FOLDER = `${TASKS_ROOT_FOLDER}/cancelled`
export const CANCELLED_SUBTASKS_FOLDER = `${CANCELLED_TASKS_FOLDER}/subTasks`
export const LEGACY_FINISHED_TASKS_FOLDER = `${TASKS_ROOT_FOLDER}/completadas`

export const TASK_INDEX_BASENAME = 'taskIndex'
export const FINISHED_TASK_INDEX_BASENAME = 'taskIndexFinished'
export const CANCELLED_TASK_INDEX_BASENAME = 'taskIndexCancelled'
export const POMODORO_LOG_BASENAME = 'pomodoro'

export const INDEX_TAG = 'index'
export const TASK_TAG = 'task'
export const SUBTASK_TAG = 'sub-task'

export const DEFAULT_BOARD_NAME = 'default'

export const TASK_STATES = ['Pendiente', 'Cancelada', 'En progreso', 'Finalizada', 'Bloqueada'] as const
export const TASK_PRIORITIES = ['Baja', 'Media', 'Alta', 'Urgente'] as const

export const ORDER_STEP = 10

export const DEFAULT_BOARDS: Array<{ name: string; color: string; activityHoursPerDay: number }> = [
  { name: DEFAULT_BOARD_NAME, color: '#2e6db0', activityHoursPerDay: 24 },
]

export const DEFAULT_GROUPS: Array<{ name: string; color: string; board?: string }> = []

export const DEFAULT_POMODORO_WORK_MINUTES = 25
export const DEFAULT_POMODORO_SHORT_BREAK_MINUTES = 5
export const DEFAULT_POMODORO_LONG_BREAK_MINUTES = 15
export const POMODORO_WORK_CYCLES_BEFORE_LONG_BREAK = 4

export const APP_STORAGE_KEY = 'task-manager:settings:v1'
