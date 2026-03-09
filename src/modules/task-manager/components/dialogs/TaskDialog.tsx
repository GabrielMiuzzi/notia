import { useEffect, useMemo, useState } from 'react'
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
} from '@mui/material'
import type { Group, TaskFormData, TaskItem, TaskPriority, TaskState } from '../../types/taskManagerTypes'

interface TaskDialogProps {
  open: boolean
  mode: 'create' | 'edit'
  task: TaskItem | null
  boardName: string
  createDefaults?: {
    parentTaskName?: string
    group?: string
  }
  groups: Group[]
  states: readonly TaskState[]
  priorities: readonly TaskPriority[]
  onClose: () => void
  onSubmit: (formData: TaskFormData) => Promise<void>
}

const INITIAL_FORM: TaskFormData = {
  title: '',
  detail: '',
  state: 'Pendiente',
  endDate: '',
  board: 'default',
  group: '',
  priority: 'Media',
  estimatedHours: 0,
  parentTaskName: '',
}

export function TaskDialog({
  open,
  mode,
  task,
  boardName,
  createDefaults,
  groups,
  states,
  priorities,
  onClose,
  onSubmit,
}: TaskDialogProps) {
  const [form, setForm] = useState<TaskFormData>(INITIAL_FORM)
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (!open) {
      return
    }

    if (mode === 'edit' && task) {
      setForm({
        title: task.title,
        detail: task.detail,
        state: task.state,
        endDate: task.endDate,
        board: task.board,
        group: task.group,
        priority: task.priority || 'Media',
        estimatedHours: task.estimatedHours,
        parentTaskName: task.parentTaskName,
      })
      return
    }

    setForm({
      ...INITIAL_FORM,
      board: boardName,
      group: createDefaults?.group ?? groups[0]?.name ?? '',
      parentTaskName: createDefaults?.parentTaskName ?? '',
    })
  }, [boardName, createDefaults?.group, createDefaults?.parentTaskName, groups, mode, open, task])

  const title = useMemo(() => (mode === 'create' ? 'Nueva tarea' : 'Editar tarea'), [mode])

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
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
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

          <TextField
            label="Tarea padre (opcional)"
            value={form.parentTaskName}
            onChange={(event) => setForm((previous) => ({ ...previous, parentTaskName: event.target.value }))}
          />
        </Stack>
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} disabled={isSubmitting}>
          Cancelar
        </Button>
        <Button onClick={handleSubmit} variant="contained" disabled={!form.title.trim() || isSubmitting}>
          Guardar
        </Button>
      </DialogActions>
    </Dialog>
  )
}
