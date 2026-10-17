import { MenuItem, TextField } from '@mui/material'
import { NotiaButton } from '../../../../components/common/NotiaButton'
import { TASK_PRIORITIES, TASK_STATES } from '../../constants/taskManagerConstants'
import type { TaskPriority, TaskState } from '../../types/taskManagerTypes'
import { hasTaskFilters, NO_TASK_FILTERS, type TaskFilters } from '../../utils/taskFilters'

interface TaskFilterBarProps {
  filters: TaskFilters
  onChange: (filters: TaskFilters) => void
  projects: readonly string[]
  people: readonly string[]
  /** Tickets shown and tickets of the view, for «3 de 12». */
  shown: number
  total: number
}

const ALL = ''

/** Search and filters over the tickets of the open board or list. */
export function TaskFilterBar({ filters, onChange, projects, people, shown, total }: TaskFilterBarProps) {
  const set = <K extends keyof TaskFilters>(key: K, value: TaskFilters[K]) => onChange({ ...filters, [key]: value })
  const active = hasTaskFilters(filters)
  return (
    <div className="tareas-filter-bar" role="search" aria-label="Filtrar tareas">
      <TextField
        size="small"
        type="search"
        label="Buscar"
        placeholder="Título, detalle, proyecto o persona"
        value={filters.query}
        onChange={(event) => set('query', event.target.value)}
        className="tareas-filter-search"
      />
      <TextField select size="small" label="Estado" value={filters.state} onChange={(event) => set('state', event.target.value as TaskState | '')} className="tareas-filter-select">
        <MenuItem value={ALL}>Todos</MenuItem>
        {TASK_STATES.map((state) => <MenuItem key={state} value={state}>{state}</MenuItem>)}
      </TextField>
      <TextField select size="small" label="Prioridad" value={filters.priority} onChange={(event) => set('priority', event.target.value as TaskPriority | '')} className="tareas-filter-select">
        <MenuItem value={ALL}>Todas</MenuItem>
        {TASK_PRIORITIES.map((priority) => <MenuItem key={priority} value={priority}>{priority}</MenuItem>)}
      </TextField>
      <TextField select size="small" label="Proyecto" value={filters.project} onChange={(event) => set('project', event.target.value)} className="tareas-filter-select" disabled={projects.length === 0 && !filters.project}>
        <MenuItem value={ALL}>Todos</MenuItem>
        {projects.map((project) => <MenuItem key={project} value={project}>{project}</MenuItem>)}
      </TextField>
      <TextField select size="small" label="Persona" value={filters.person} onChange={(event) => set('person', event.target.value)} className="tareas-filter-select" disabled={people.length === 0 && !filters.person}>
        <MenuItem value={ALL}>Todas</MenuItem>
        {people.map((person) => <MenuItem key={person} value={person}>{person}</MenuItem>)}
      </TextField>
      {active ? (
        <>
          <span className="tareas-filter-count" role="status">{shown} de {total}</span>
          <NotiaButton className="tareas-filter-clear" onClick={() => onChange(NO_TASK_FILTERS)}>Limpiar filtros</NotiaButton>
        </>
      ) : null}
    </div>
  )
}
