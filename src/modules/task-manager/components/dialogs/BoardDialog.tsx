import { useEffect, useState } from 'react'
import {
  Stack,
  TextField,
} from '@mui/material'
import type { Board } from '../../types/taskManagerTypes'
import { NotiaButton } from '../../../../components/common/NotiaButton'
import { NotiaModalShell } from '../../../../components/notia/NotiaModalShell'
import { ActivityHoursClockPicker } from './ActivityHoursClockPicker'

interface BoardDialogProps {
  open: boolean
  mode: 'create' | 'edit'
  board: Board | null
  onClose: () => void
  onSubmit: (payload: { name: string; color: string; activityHoursPerDay: number }) => Promise<void>
}

export function BoardDialog({ open, mode, board, onClose, onSubmit }: BoardDialogProps) {
  const [name, setName] = useState('')
  const [color, setColor] = useState('#2e6db0')
  const [activityHoursPerDay, setActivityHoursPerDay] = useState(24)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const isDefaultBoard = mode === 'edit' && board?.name === 'default'

  useEffect(() => {
    if (!open) {
      return
    }

    setName(board?.name ?? '')
    setColor(board?.color ?? '#2e6db0')
    const boardActivityHours = board?.activityHoursPerDay
    setActivityHoursPerDay(
      Number.isFinite(boardActivityHours) ? Math.max(0, Math.min(24, Math.round(boardActivityHours as number))) : 24,
    )
  }, [board, open])

  const handleSubmit = async () => {
    if (!name.trim()) {
      return
    }

    setIsSubmitting(true)
    try {
      await onSubmit({ name, color, activityHoursPerDay })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <NotiaModalShell open={open} onClose={onClose} size="sm" panelClassName="tareas-dialog">
      <div className="tareas-dialog-header">
        <h2>{mode === 'create' ? 'Nuevo tablero' : 'Editar tablero'}</h2>
      </div>
      <div className="tareas-dialog-body">
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            label="Nombre"
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoFocus
            disabled={isDefaultBoard}
          />
          <TextField
            label="Color"
            type="color"
            value={color}
            onChange={(event) => setColor(event.target.value)}
            disabled={isDefaultBoard}
          />
          <div className="tareas-field-block">
            <span className="tareas-field-label">Horas de actividad por dia</span>
            <ActivityHoursClockPicker value={activityHoursPerDay} onChange={setActivityHoursPerDay} />
          </div>
        </Stack>
      </div>
      <div className="tareas-dialog-actions">
        <NotiaButton onClick={onClose} disabled={isSubmitting}>
          Cancelar
        </NotiaButton>
        <NotiaButton variant="primary" onClick={() => void handleSubmit()} disabled={!name.trim() || isSubmitting}>
          Guardar
        </NotiaButton>
      </div>
    </NotiaModalShell>
  )
}
