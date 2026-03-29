import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { NotiaModalShell } from './NotiaModalShell'
import { NotiaButton } from '../common/NotiaButton'

export interface CreateChatModalSubmitPayload {
  longTermMemoryEnabled: boolean
  contextMemoryEnabled: boolean
  contextMemoryMessageCount: number
}

interface CreateChatModalProps {
  open: boolean
  errorMessage?: string | null
  isSubmitting?: boolean
  onClose: () => void
  onSubmit: (payload: CreateChatModalSubmitPayload) => void
}

const DEFAULT_CONTEXT_MEMORY_COUNT = 10

export function CreateChatModal({
  open,
  errorMessage = null,
  isSubmitting = false,
  onClose,
  onSubmit,
}: CreateChatModalProps) {
  const [longTermMemoryEnabled, setLongTermMemoryEnabled] = useState(true)
  const [contextMemoryEnabled, setContextMemoryEnabled] = useState(true)
  const [contextMemoryMessageCount, setContextMemoryMessageCount] = useState(DEFAULT_CONTEXT_MEMORY_COUNT)

  useEffect(() => {
    if (!open) {
      return
    }

    setLongTermMemoryEnabled(true)
    setContextMemoryEnabled(true)
    setContextMemoryMessageCount(DEFAULT_CONTEXT_MEMORY_COUNT)
  }, [open])

  if (!open) {
    return null
  }

  return (
    <NotiaModalShell open={open} onClose={onClose} size="sm" panelClassName="notia-create-chat-modal">
      <div className="notia-create-chat-modal-header">
        <h2>Nuevo chat</h2>
        <NotiaButton size="icon" variant="ghost" className="notia-settings-close" title="Cerrar" onClick={onClose}>
          <X size={16} />
        </NotiaButton>
      </div>
      <form
        className="notia-create-chat-modal-body"
        onSubmit={(event) => {
          event.preventDefault()
          onSubmit({
            longTermMemoryEnabled,
            contextMemoryEnabled,
            contextMemoryMessageCount: Math.max(1, Math.round(contextMemoryMessageCount || DEFAULT_CONTEXT_MEMORY_COUNT)),
          })
        }}
      >
        <label className="notia-create-chat-modal-check">
          <input
            type="checkbox"
            checked={longTermMemoryEnabled}
            onChange={(event) => {
              setLongTermMemoryEnabled(event.target.checked)
            }}
          />
          <div>
            <strong>LongTermMemory</strong>
            <span>Permite usar la memoria persistente del archivo `LongTermMemory.md`.</span>
          </div>
        </label>

        <label className="notia-create-chat-modal-check">
          <input
            type="checkbox"
            checked={contextMemoryEnabled}
            onChange={(event) => {
              setContextMemoryEnabled(event.target.checked)
            }}
          />
          <div>
            <strong>Memoria de contexto</strong>
            <span>Conserva una ventana de mensajes recientes para el chat.</span>
          </div>
        </label>

        <label className="notia-create-chat-modal-field">
          <span>Cantidad de mensajes de memoria de contexto</span>
          <input
            type="number"
            min={1}
            step={1}
            value={contextMemoryMessageCount}
            disabled={!contextMemoryEnabled}
            onChange={(event) => {
              setContextMemoryMessageCount(Math.max(1, Number(event.target.value) || DEFAULT_CONTEXT_MEMORY_COUNT))
            }}
          />
        </label>

        {errorMessage ? <div className="notia-create-chat-modal-error">{errorMessage}</div> : null}

        <div className="notia-create-chat-modal-actions">
          <NotiaButton variant="secondary" onClick={onClose} disabled={isSubmitting}>
            Cancelar
          </NotiaButton>
          <NotiaButton type="submit" variant="primary" disabled={isSubmitting}>
            {isSubmitting ? 'Creando...' : 'Aceptar'}
          </NotiaButton>
        </div>
      </form>
    </NotiaModalShell>
  )
}
