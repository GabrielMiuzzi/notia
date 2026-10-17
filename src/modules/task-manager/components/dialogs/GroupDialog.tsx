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
import type { TaskColumnKind, TaskColumnKindOption } from '../../types/taskBoardTypes'
import { NotiaButton } from '../../../../components/common/NotiaButton'
import { TaskManagerModal } from "../common/TaskManagerModal"

interface GroupDialogProps {
  open: boolean
  mode: 'create' | 'edit'
  group: Group | null
  boards: Board[]
  activeBoard: string
  /** Kinds a column can have, with the labels Rust gives them. */
  columnKinds: TaskColumnKindOption[]
  onClose: () => void
  onSubmit: (payload: { name: string; color: string; board: string; columnKind: TaskColumnKind }) => Promise<void>
  onDelete: () => void
}

export function GroupDialog({
  open,
  mode,
  group,
  boards,
  activeBoard,
  columnKinds,
  onClose,
  onSubmit,
  onDelete,
}: GroupDialogProps) {
  const [name, setName] = useState('')
  const [color, setColor] = useState('#2e6db0')
  const [board, setBoard] = useState(activeBoard)
  const [columnKind, setColumnKind] = useState<TaskColumnKind>('custom')
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (!open) {
      return
    }

    setName(group?.name ?? '')
    setColor(group?.color ?? '#2e6db0')
    setBoard(group?.board ?? activeBoard)
    setColumnKind(group?.kind ?? 'custom')
  }, [activeBoard, group, open])

  const handleSubmit = async () => {
    if (!name.trim()) {
      return
    }

    setIsSubmitting(true)
    try {
      await onSubmit({ name, color, board, columnKind })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <TaskManagerModal open={open} onClose={onClose} size="sm" >
      <div className="tareas-dialog-header">
        <h2>{mode === 'create' ? 'Nueva columna' : 'Editar columna'}</h2>
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
            <InputLabel>Tipo</InputLabel>
            <Select
              label="Tipo"
              value={columnKind}
              onChange={(event) => setColumnKind(event.target.value as TaskColumnKind)}
            >
              {columnKinds.map((option) => (
                <MenuItem key={option.kind} value={option.kind}>
                  {option.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

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
        {mode === 'edit' && group ? (
          <NotiaButton variant="danger" onClick={onDelete} disabled={isSubmitting}>
            Eliminar columna
          </NotiaButton>
        ) : null}
        <NotiaButton onClick={onClose} disabled={isSubmitting}>
          Cancelar
        </NotiaButton>
        <NotiaButton variant="primary" onClick={() => void handleSubmit()} disabled={!name.trim() || isSubmitting}>
          Guardar
        </NotiaButton>
      </div>
    </TaskManagerModal>
  )
}
