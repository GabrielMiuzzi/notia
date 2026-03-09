import type { TaskState } from '../types/taskManagerTypes'

const STATUS_ALIASES: Record<string, TaskState> = {
  cancelada: 'Cancelada',
  cancelado: 'Cancelada',
  desestimada: 'Cancelada',
  desestimado: 'Cancelada',
  'en progreso': 'En progreso',
  pendiente: 'Pendiente',
  finalizada: 'Finalizada',
  finalizado: 'Finalizada',
  completada: 'Finalizada',
  completado: 'Finalizada',
  bloqueada: 'Bloqueada',
  bloqueado: 'Bloqueada',
}

export function normalizeTaskState(value?: string): TaskState {
  if (!value) {
    return 'Pendiente'
  }

  const normalizedValue = value.trim().toLowerCase()
  return STATUS_ALIASES[normalizedValue] ?? 'Pendiente'
}
