import { useEffect, useState } from 'react'
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
} from '@mui/material'
import type { Board } from '../../types/taskManagerTypes'

interface BoardDialogProps {
  open: boolean
  mode: 'create' | 'edit'
  board: Board | null
  onClose: () => void
  onSubmit: (payload: { name: string; color: string }) => Promise<void>
}

export function BoardDialog({ open, mode, board, onClose, onSubmit }: BoardDialogProps) {
  const [name, setName] = useState('')
  const [color, setColor] = useState('#2e6db0')
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (!open) {
      return
    }

    setName(board?.name ?? '')
    setColor(board?.color ?? '#2e6db0')
  }, [board, open])

  const handleSubmit = async () => {
    if (!name.trim()) {
      return
    }

    setIsSubmitting(true)
    try {
      await onSubmit({ name, color })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{mode === 'create' ? 'Nuevo tablero' : 'Editar tablero'}</DialogTitle>
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
