import { useEffect, useState } from 'react'
import {
  Autocomplete,
  Chip,
  FormControlLabel,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Switch,
  TextField,
} from '@mui/material'
import type { Group, TaskFormData, TaskPriority, TaskState } from '../../types/taskManagerTypes'
import { NotiaButton } from '../../../../components/common/NotiaButton'
import { TaskManagerModal } from "../common/TaskManagerModal"

/** Creates a task or a subtask; an existing task is edited in its Markdown. */
interface TaskDialogProps {
  open: boolean
  boardName: string
  createDefaults?: {
    parentTaskName?: string
    group?: string
  }
  groups: Group[]
  states: readonly TaskState[]
  priorities: readonly TaskPriority[]
  /** Projects and people of the other tickets, offered while typing. */
  projectOptions: readonly string[]
  peopleOptions: readonly string[]
  onClose: () => void
  onSubmit: (formData: TaskFormData) => Promise<void>
}

const INITIAL_FORM: TaskFormData = {
  title: '',
  detail: '',
  state: 'Pendiente',
  endDate: '',
  dynamicEndDate: true,
  board: 'default',
  group: '',
  priority: 'Media',
  estimatedHours: 0,
  parentTaskName: '',
  project: '',
  assignees: [],
}

export function TaskDialog({
  open,
  boardName,
  createDefaults,
  groups,
  states,
  priorities,
  projectOptions,
  peopleOptions,
  onClose,
  onSubmit,
}: TaskDialogProps) {
  const [form, setForm] = useState<TaskFormData>(INITIAL_FORM)
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (!open) {
      return
    }

    setForm({
      ...INITIAL_FORM,
      board: boardName,
      group: createDefaults?.group ?? groups[0]?.name ?? '',
      parentTaskName: createDefaults?.parentTaskName ?? '',
      dynamicEndDate: true,
    })
  }, [boardName, createDefaults?.group, createDefaults?.parentTaskName, groups, open])

  const title = createDefaults?.parentTaskName ? 'Nueva subtarea' : 'Nueva tarea'

  const handleSubmit = async () => {
    if (!form.title.trim()) {
      return
    }

    setIsSubmitting(true)
    try {
      await onSubmit({
        ...form,
        title: form.title.trim(),
        detail: form.detail.trim(),
        project: form.project.trim(),
        assignees: form.assignees.map((person) => person.trim()).filter(Boolean),
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <TaskManagerModal open={open} onClose={onClose} size="md" >
      <div className="tareas-dialog-header">
        <h2>{title}</h2>
      </div>
      <div className="tareas-dialog-body">
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            label="Título"
            value={form.title}
            onChange={(event) => setForm((previous) => ({ ...previous, title: event.target.value }))}
            autoFocus
          />

          <TextField
            label="Detalle"
            value={form.detail}
            multiline
            minRows={3}
            onChange={(event) => setForm((previous) => ({ ...previous, detail: event.target.value }))}
          />

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <FormControl fullWidth>
              <InputLabel>Estado</InputLabel>
              <Select
                label="Estado"
                value={form.state}
                onChange={(event) => setForm((previous) => ({ ...previous, state: event.target.value as TaskState }))}
              >
                {states.map((state) => (
                  <MenuItem key={state} value={state}>
                    {state}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <FormControl fullWidth>
              <InputLabel>Prioridad</InputLabel>
              <Select
                label="Prioridad"
                value={form.priority}
                onChange={(event) => setForm((previous) => ({ ...previous, priority: event.target.value as TaskPriority }))}
              >
                {priorities.map((priority) => (
                  <MenuItem key={priority} value={priority}>
                    {priority}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Stack>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <Autocomplete
              freeSolo
              fullWidth
              options={projectOptions as string[]}
              value={form.project}
              onInputChange={(_event, value) => setForm((previous) => ({ ...previous, project: value }))}
              renderInput={(params) => <TextField {...params} label="Proyecto" placeholder="Remesas, Corresponsalías…" />}
            />
            <Autocomplete
              multiple
              freeSolo
              fullWidth
              options={peopleOptions as string[]}
              value={form.assignees}
              onChange={(_event, value) => setForm((previous) => ({ ...previous, assignees: value.map(String) }))}
              renderTags={(value, getTagProps) => value.map((person, index) => {
                const { key, ...tagProps } = getTagProps({ index })
                return <Chip key={key} size="small" label={person} {...tagProps} />
              })}
              renderInput={(params) => <TextField {...params} label="Asignados" placeholder="Escribí un nombre y Enter" />}
            />
          </Stack>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <FormControl fullWidth>
              <InputLabel>Grupo</InputLabel>
              <Select
                label="Grupo"
                value={form.group}
                onChange={(event) => setForm((previous) => ({ ...previous, group: event.target.value }))}
              >
                <MenuItem value="">Sin grupo</MenuItem>
                {groups.map((group) => (
                  <MenuItem key={`${group.board || 'default'}:${group.name}`} value={group.name}>
                    {group.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <TextField
              label="Estimación (horas)"
              type="number"
              value={form.estimatedHours}
              onChange={(event) => setForm((previous) => ({ ...previous, estimatedHours: Number(event.target.value) || 0 }))}
              fullWidth
            />
          </Stack>

          <TextField
            label="Fecha límite"
            type="datetime-local"
            value={form.endDate ? form.endDate.slice(0, 16) : ''}
            onChange={(event) => setForm((previous) => ({
              ...previous,
              endDate: event.target.value ? new Date(event.target.value).toISOString() : '',
            }))}
            InputLabelProps={{ shrink: true }}
          />

          <FormControlLabel
            control={(
              <Switch
                checked={form.dynamicEndDate}
                onChange={(event) => setForm((previous) => ({ ...previous, dynamicEndDate: event.target.checked }))}
              />
            )}
            label="Fecha de finalizacion dinamica"
          />

          <TextField
            label="Tarea padre (opcional)"
            value={form.parentTaskName}
            onChange={(event) => setForm((previous) => ({ ...previous, parentTaskName: event.target.value }))}
          />
        </Stack>
      </div>

      <div className="tareas-dialog-actions">
        <NotiaButton onClick={onClose} disabled={isSubmitting}>
          Cancelar
        </NotiaButton>
        <NotiaButton variant="primary" onClick={() => void handleSubmit()} disabled={!form.title.trim() || isSubmitting}>
          {isSubmitting ? 'Guardando…' : 'Guardar'}
        </NotiaButton>
      </div>
    </TaskManagerModal>
  )
}
