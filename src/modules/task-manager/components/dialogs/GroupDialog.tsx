import { useEffect, useState } from 'react'
import {
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
} from '@mui/material'
import type { Board, Group } from '../../types/taskManagerTypes'
import { NotiaButton } from '../../../../components/common/NotiaButton'
import { NotiaModalShell } from '../../../../components/notia/NotiaModalShell'

interface GroupDialogProps {
  open: boolean
  mode: 'create' | 'edit'
  group: Group | null
  boards: Board[]
  activeBoard: string
  onClose: () => void
  onSubmit: (payload: { name: string; color: string; board: string }) => Promise<void>
}

export function GroupDialog({
  open,
  mode,
  group,
  boards,
  activeBoard,
  onClose,
  onSubmit,
}: GroupDialogProps) {
  const [name, setName] = useState('')
  const [color, setColor] = useState('#2e6db0')
  const [board, setBoard] = useState(activeBoard)
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (!open) {
      return
    }

    setName(group?.name ?? '')
    setColor(group?.color ?? '#2e6db0')
    setBoard(group?.board ?? activeBoard)
  }, [activeBoard, group, open])

  const handleSubmit = async () => {
    if (!name.trim()) {
      return
    }

    setIsSubmitting(true)
    try {
      await onSubmit({ name, color, board })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <NotiaModalShell open={open} onClose={onClose} size="sm" panelClassName="tareas-dialog">
      <div className="tareas-dialog-header">
        <h2>{mode === 'create' ? 'Nuevo grupo' : 'Editar grupo'}</h2>
      </div>
      <div className="tareas-dialog-body">
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            label="Nombre"
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoFocus
          />

          <TextField
            label="Color"
            type="color"
            value={color}
            onChange={(event) => setColor(event.target.value)}
          />

          <FormControl>
            <InputLabel>Tablero</InputLabel>
            <Select
              label="Tablero"
              value={board}
              onChange={(event) => setBoard(event.target.value)}
            >
              {boards.map((boardItem) => (
                <MenuItem key={boardItem.name} value={boardItem.name}>
                  {boardItem.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
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
