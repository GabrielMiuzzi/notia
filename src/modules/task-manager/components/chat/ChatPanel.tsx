import { useMemo, useState, type FormEvent } from 'react'
import {
  Box,
  FormControl,
  InputLabel,
  List,
  ListItemButton,
  ListItemText,
  MenuItem,
  Paper,
  Select,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import { MessageCircle, Plus, Send, Settings, Trash2 } from 'lucide-react'
import type { ChatMessage, ChatSessionFile, ChatSessionOptions } from '../../types/taskManagerTypes'
import { NotiaButton } from '../../../../components/common/NotiaButton'
import { NotiaModalShell } from '../../../../components/notia/NotiaModalShell'

interface ChatPanelProps {
  sessions: ChatSessionFile[]
  activeChatPath: string | null
  messages: ChatMessage[]
  isSending: boolean
  transientThinking: string
  transientStreaming: string
  netrunnerBaseUrl: string
  chatHistoryLimit: number
  chatHistoryOptions: readonly number[]
  onSetActiveChatPath: (path: string | null) => void
  onCreateChat: (title: string, options: ChatSessionOptions) => Promise<void>
  onUpdateChat: (chatPath: string, title: string, options: ChatSessionOptions) => Promise<void>
  onDeleteChat: (chatPath: string) => Promise<void>
  onSendMessage: (input: string) => Promise<void>
  onSetNetrunnerBaseUrl: (value: string) => void
  onSetChatHistoryLimit: (value: number) => void
}

export function ChatPanel({
  sessions,
  activeChatPath,
  messages,
  isSending,
  transientThinking,
  transientStreaming,
  netrunnerBaseUrl,
  chatHistoryLimit,
  chatHistoryOptions,
  onSetActiveChatPath,
  onCreateChat,
  onUpdateChat,
  onDeleteChat,
  onSendMessage,
  onSetNetrunnerBaseUrl,
  onSetChatHistoryLimit,
}: ChatPanelProps) {
  const [composer, setComposer] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [editSession, setEditSession] = useState<ChatSessionFile | null>(null)

  const activeSession = useMemo(
    () => sessions.find((session) => session.path === activeChatPath) ?? null,
    [activeChatPath, sessions],
  )

  const handleSend = async (event?: FormEvent) => {
    event?.preventDefault()
    if (!composer.trim()) {
      return
    }

    const payload = composer
    setComposer('')
    await onSendMessage(payload)
  }

  return (
    <Stack spacing={2} sx={{ height: '100%' }}>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ height: '100%', minHeight: 0 }}>
        <Paper variant="outlined" sx={{ width: { xs: '100%', md: 300 }, p: 1.5, borderRadius: 2, display: 'flex', flexDirection: 'column' }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
            <Typography variant="subtitle1" fontWeight={700}>
              Sesiones
            </Typography>
            <Stack direction="row" spacing={1}>
              <NotiaButton size="icon" onClick={() => setSettingsOpen(true)}>
                <Settings size={14} />
              </NotiaButton>
              <NotiaButton size="icon" onClick={() => setCreateOpen(true)}>
                <Plus size={14} />
              </NotiaButton>
            </Stack>
          </Stack>

          <Box sx={{ overflowY: 'auto', minHeight: 0 }}>
            <List dense disablePadding>
              {sessions.map((session) => (
                <Stack key={session.path} direction="row" spacing={0.5} alignItems="center">
                  <ListItemButton
                    selected={session.path === activeChatPath}
                    onClick={() => onSetActiveChatPath(session.path)}
                    sx={{ borderRadius: 1, flex: 1 }}
                  >
                    <ListItemText
                      primary={session.name}
                      secondary={session.options.longTermMemory ? 'Memoria larga activa' : 'Memoria larga inactiva'}
                    />
                  </ListItemButton>

                  <NotiaButton size="icon" onClick={() => setEditSession(session)}>
                    <MessageCircle size={14} />
                  </NotiaButton>
                  <NotiaButton size="icon" variant="danger" onClick={() => void onDeleteChat(session.path)}>
                    <Trash2 size={14} />
                  </NotiaButton>
                </Stack>
              ))}

              {sessions.length === 0 ? (
                <Typography variant="body2" color="text.secondary" sx={{ px: 1, py: 1 }}>
                  Sin chats todavía.
                </Typography>
              ) : null}
            </List>
          </Box>
        </Paper>

        <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
          <Stack spacing={1} sx={{ mb: 2 }}>
            <Typography variant="h6" fontWeight={700}>
              {activeSession?.name ?? 'Chat'}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Integración con Netrunner + fallback local.
            </Typography>
          </Stack>

          <Stack spacing={1.5} sx={{ overflowY: 'auto', flex: 1, minHeight: 0, pb: 1 }}>
            {messages.map((message) => (
              <Box
                key={message.id}
                sx={{
                  alignSelf: message.role === 'user' ? 'flex-end' : 'flex-start',
                  maxWidth: '80%',
                  px: 1.5,
                  py: 1,
                  borderRadius: 2,
                  backgroundColor: message.role === 'user' ? 'primary.main' : 'action.hover',
                  color: message.role === 'user' ? 'primary.contrastText' : 'text.primary',
                }}
              >
                <Typography variant="body2">{message.content}</Typography>
              </Box>
            ))}

            {transientThinking ? (
              <Box sx={{ alignSelf: 'flex-start', px: 1.5, py: 1, borderRadius: 2, backgroundColor: 'warning.light' }}>
                <Typography variant="caption">Pensando: {transientThinking}</Typography>
              </Box>
            ) : null}

            {transientStreaming ? (
              <Box sx={{ alignSelf: 'flex-start', px: 1.5, py: 1, borderRadius: 2, backgroundColor: 'action.selected' }}>
                <Typography variant="caption">Respuesta: {transientStreaming}</Typography>
              </Box>
            ) : null}
          </Stack>

          <Box component="form" onSubmit={(event) => void handleSend(event)} sx={{ mt: 1 }}>
            <Stack direction="row" spacing={1}>
              <TextField
                placeholder="Escribí tu mensaje..."
                value={composer}
                onChange={(event) => setComposer(event.target.value)}
                fullWidth
                disabled={!activeSession || isSending}
              />
              <NotiaButton type="submit" variant="primary" disabled={!activeSession || isSending || !composer.trim()}>
                <Send size={16} />
              </NotiaButton>
            </Stack>
          </Box>
        </Paper>
      </Stack>

      <ChatSessionDialog
        key={`create-${createOpen ? 'open' : 'closed'}`}
        open={createOpen}
        title="Nuevo chat"
        confirmLabel="Crear"
        initialName=""
        initialOptions={{ chatMemory: true, longTermMemory: false }}
        onClose={() => setCreateOpen(false)}
        onConfirm={async (name, options) => {
          await onCreateChat(name, options)
          setCreateOpen(false)
        }}
      />

      <ChatSessionDialog
        key={
          editSession
            ? `edit-${editSession.path}-${editSession.name}-${editSession.options.chatMemory}-${editSession.options.longTermMemory}`
            : 'edit-closed'
        }
        open={Boolean(editSession)}
        title="Configurar chat"
        confirmLabel="Guardar"
        initialName={editSession?.name ?? ''}
        initialOptions={editSession?.options ?? { chatMemory: true, longTermMemory: false }}
        onClose={() => setEditSession(null)}
        onConfirm={async (name, options) => {
          if (!editSession) {
            return
          }
          await onUpdateChat(editSession.path, name, options)
          setEditSession(null)
        }}
      />

      <NotiaModalShell open={settingsOpen} onClose={() => setSettingsOpen(false)} size="md" panelClassName="tareas-dialog">
        <div className="tareas-dialog-header">
          <h2>Configuración del asistente</h2>
        </div>
        <div className="tareas-dialog-body">
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="Base URL Netrunner"
              value={netrunnerBaseUrl}
              onChange={(event) => onSetNetrunnerBaseUrl(event.target.value)}
            />
            <FormControl>
              <InputLabel>Historial en contexto</InputLabel>
              <Select
                label="Historial en contexto"
                value={chatHistoryLimit}
                onChange={(event) => onSetChatHistoryLimit(Number(event.target.value))}
              >
                {chatHistoryOptions.map((option) => (
                  <MenuItem key={option} value={option}>
                    {option} mensajes
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Stack>
        </div>
        <div className="tareas-dialog-actions">
          <NotiaButton onClick={() => setSettingsOpen(false)}>Cerrar</NotiaButton>
        </div>
      </NotiaModalShell>
    </Stack>
  )
}

interface ChatSessionDialogProps {
  open: boolean
  title: string
  confirmLabel: string
  initialName: string
  initialOptions: ChatSessionOptions
  onClose: () => void
  onConfirm: (name: string, options: ChatSessionOptions) => Promise<void>
}

function ChatSessionDialog({
  open,
  title,
  confirmLabel,
  initialName,
  initialOptions,
  onClose,
  onConfirm,
}: ChatSessionDialogProps) {
  const [name, setName] = useState(initialName)
  const [chatMemory, setChatMemory] = useState(initialOptions.chatMemory)
  const [longTermMemory, setLongTermMemory] = useState(initialOptions.longTermMemory)

  const handleConfirm = async () => {
    await onConfirm(name, { chatMemory, longTermMemory })
  }

  return (
    <NotiaModalShell open={open} onClose={onClose} size="sm" panelClassName="tareas-dialog">
      <div className="tareas-dialog-header">
        <h2>{title}</h2>
      </div>
      <div className="tareas-dialog-body">
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            label="Título"
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoFocus
          />

          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Typography variant="body2">Memoria de chat</Typography>
            <Switch checked={chatMemory} onChange={(event) => setChatMemory(event.target.checked)} />
          </Stack>

          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Typography variant="body2">Memoria de largo plazo</Typography>
            <Switch checked={longTermMemory} onChange={(event) => setLongTermMemory(event.target.checked)} />
          </Stack>
        </Stack>
      </div>
      <div className="tareas-dialog-actions">
        <NotiaButton onClick={onClose}>Cancelar</NotiaButton>
        <NotiaButton variant="primary" onClick={() => void handleConfirm()}>
          {confirmLabel}
        </NotiaButton>
      </div>
    </NotiaModalShell>
  )
}
