import { useEffect, useState } from 'react'
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
import type { Board, Group } from '../../types/taskManagerTypes'

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
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{mode === 'create' ? 'Nuevo grupo' : 'Editar grupo'}</DialogTitle>
      <DialogContent>
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
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={isSubmitting}>
          Cancelar
        </Button>
        <Button onClick={handleSubmit} variant="contained" disabled={!name.trim() || isSubmitting}>
          Guardar
        </Button>
      </DialogActions>
    </Dialog>
  )
}
