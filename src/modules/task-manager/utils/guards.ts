import type { TaskFrontmatter } from '../types/taskManagerTypes'

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

export function toTaskFrontmatter(value: unknown): TaskFrontmatter | null {
  if (!isRecord(value)) {
    return null
  }

  const frontmatter: TaskFrontmatter = {}

  if (typeof value.tarea === 'string') frontmatter.tarea = value.tarea
  if (typeof value.detalle === 'string') frontmatter.detalle = value.detalle
  if (typeof value.estado === 'string') frontmatter.estado = value.estado
  if (typeof value.fechaInicio === 'string') frontmatter.fechaInicio = value.fechaInicio
  if (typeof value.fechaFin === 'string') frontmatter.fechaFin = value.fechaFin
  if (typeof value.tablero === 'string') frontmatter.tablero = value.tablero
  if (typeof value.equipo === 'string') frontmatter.equipo = value.equipo
  if (typeof value.prioridad === 'string') frontmatter.prioridad = value.prioridad
  if (typeof value.dedicado === 'number' || typeof value.dedicado === 'string') frontmatter.dedicado = value.dedicado
  if (typeof value.estimacion === 'number' || typeof value.estimacion === 'string') frontmatter.estimacion = value.estimacion
  if (typeof value.desvio === 'number' || typeof value.desvio === 'string') frontmatter.desvio = value.desvio
  if (typeof value.parent === 'string') frontmatter.parent = value.parent
  if (Array.isArray(value.childs) && value.childs.every((item) => typeof item === 'string')) frontmatter.childs = value.childs
  if (typeof value.childs === 'string') frontmatter.childs = value.childs
  if (Array.isArray(value.tags) && value.tags.every((item) => typeof item === 'string')) frontmatter.tags = value.tags
  if (typeof value.tags === 'string') frontmatter.tags = value.tags
  if (typeof value.order === 'number' || typeof value.order === 'string') frontmatter.order = value.order

  return frontmatter
}
