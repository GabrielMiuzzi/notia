// Values the board shows; the backend owns the rules behind them.

export const TASK_STATES = ['Pendiente', 'Cancelada', 'En progreso', 'Finalizada', 'Bloqueada'] as const
export const TASK_PRIORITIES = ['Baja', 'Media', 'Alta', 'Urgente'] as const

export const APP_STORAGE_KEY = 'task-manager:settings:v1'
