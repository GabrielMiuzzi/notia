import { useEffect, useRef } from 'react'
import type { AiPreferences } from '../../../services/preferences/aiSettingsStorage'
import type { TelegramPreferences } from '../../../services/preferences/telegramSettingsStorage'
import type { NotiaLibrary } from '../../../types/notia'
import {
  CHAT_AGENT_MAX_ROUNDS,
  CHAT_AGENT_SINGLE_CALL_TOOL_NAMES,
  createChatScopedAgent,
} from '../../../services/chat/chatScopedAgentRuntime'
import { runNativeToolAgent } from '../../../services/ai/aiRuntime'
import type { StoredChatMessage } from '../../../services/chat/chatDocumentStorage'
import { loadLibraryFileOptions } from '../../../services/chat/chatAttachmentRuntime'
import { answerTelegramCallback, pollTelegramUpdates, sendTelegramMessage, transcribeTelegramAudio, type TelegramUpdate } from '../../../services/telegram/telegramRuntime'

interface Params {
  library: NotiaLibrary | null
  aiPreferences: AiPreferences
  telegram: TelegramPreferences
  onTelegramChange: (value: TelegramPreferences) => void
  onLibraryChanged: () => void
}

interface PendingInput { resolve: (value: string) => void; reject: (error: Error) => void }

const TELEGRAM_CONFIRMATION_TIMEOUT_MS = 2 * 60 * 1_000

export function parseTelegramConfirmationDecision(value: string): boolean | null {
  const normalized = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[,.!?¿¡]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (/^(si|confirmo|si confirmo|confirmar|acepto)$/.test(normalized)) return true
  if (/^(no|cancelo|no confirmo|cancelar|rechazo)$/.test(normalized)) return false
  return null
}

const escapeTelegramHtml = (value: string): string => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')

export function useTelegramAgentBridge({ library, aiPreferences, telegram, onTelegramChange, onLibraryChanged }: Params): void {
  const currentRef = useRef({ library, aiPreferences, telegram, onTelegramChange, onLibraryChanged })
  const historyRef = useRef<StoredChatMessage[]>([])
  const busyRef = useRef(false)
  const pendingInputRef = useRef<PendingInput | null>(null)
  const confirmationRef = useRef<Map<string, (accepted: boolean) => void>>(new Map())
  const choicesRef = useRef<string[]>([])
  const libraryId = library?.id
  const telegramEnabled = telegram.enabled
  const telegramToken = telegram.botToken
  const authorizedChatIdValue = telegram.authorizedPeer?.chatId ?? 0
  const authorizedUserId = telegram.authorizedPeer?.userId ?? 0
  currentRef.current = { library, aiPreferences, telegram, onTelegramChange, onLibraryChanged }

  useEffect(() => {
    historyRef.current = []
    pendingInputRef.current?.reject(new Error('La biblioteca activa cambio.'))
    pendingInputRef.current = null
    confirmationRef.current.clear()
  }, [libraryId])

  useEffect(() => {
    if (!currentRef.current.library || !telegramEnabled || !telegramToken) return
    const token = telegramToken
    const authorizedChatId = authorizedChatIdValue
    let cancelled = false
    let offset = currentRef.current.telegram.updateOffset
    const updateTelegram = (next: TelegramPreferences) => {
      currentRef.current = { ...currentRef.current, telegram: next }
      currentRef.current.onTelegramChange(next)
    }

    const waitForText = (question: string, choices: string[], signal: AbortSignal): Promise<string> => {
      choicesRef.current = choices
      void sendTelegramMessage(token, authorizedChatId, question, choices.map((choice, index) => ({ label: choice.slice(0, 48), data: `choice:${index}` })))
      return new Promise((resolve, reject) => {
        const abort = () => reject(new Error('Operacion cancelada.'))
        signal.addEventListener('abort', abort, { once: true })
        pendingInputRef.current = { resolve: (answer) => { signal.removeEventListener('abort', abort); pendingInputRef.current = null; resolve(answer) }, reject }
      })
    }

    const confirm = (question: string, signal: AbortSignal): Promise<boolean> => {
      const id = crypto.randomUUID().slice(0, 8)
      void sendTelegramMessage(token, authorizedChatId, `Confirmacion requerida:\n${question}`, [
        { label: 'Confirmar', data: `confirm:${id}:yes` }, { label: 'Cancelar', data: `confirm:${id}:no` },
      ])
      return new Promise((resolve, reject) => {
        const timeoutId = window.setTimeout(() => {
          confirmationRef.current.delete(id)
          resolve(false)
          void sendTelegramMessage(token, authorizedChatId, 'La confirmacion vencio despues de 2 minutos. No se aplicaron cambios.')
        }, TELEGRAM_CONFIRMATION_TIMEOUT_MS)
        const abort = () => {
          window.clearTimeout(timeoutId)
          confirmationRef.current.delete(id)
          reject(new Error('Operacion cancelada.'))
        }
        signal.addEventListener('abort', abort, { once: true })
        confirmationRef.current.set(id, (accepted) => {
          window.clearTimeout(timeoutId)
          signal.removeEventListener('abort', abort)
          confirmationRef.current.delete(id)
          resolve(accepted)
        })
      })
    }

    const runAgent = async (text: string) => {
      const state = currentRef.current
      if (!state.library || busyRef.current) {
        await sendTelegramMessage(token, authorizedChatId, 'Notia todavia esta procesando la consulta anterior.')
        return
      }
      busyRef.current = true
      try {
        const files = await loadLibraryFileOptions(state.library)
        const agent = await createChatScopedAgent({
          scope: 'library', library: state.library, scopePaths: files.map((file) => file.path),
          requestClarification: (question, signal, choices = []) => waitForText(question, choices, signal),
          requestConfirmation: confirm,
          requestExecutionPlanApproval: async (steps, signal) => ({
            approved: await confirm(
              `Aprobar este plan de ejecucion:\n${steps.map((step, index) => `${index + 1}. ${step.label}`).join('\n')}`,
              signal,
            ),
          }),
        })
        const answer = await runNativeToolAgent(state.aiPreferences, {
          systemPrompt: agent.systemPrompt, prompt: text, previousMessages: historyRef.current,
          tools: agent.tools, executeTool: agent.executeTool, validateFinalAnswer: agent.validateFinalAnswer,
          maxRounds: CHAT_AGENT_MAX_ROUNDS,
          singleCallToolNames: [...CHAT_AGENT_SINGLE_CALL_TOOL_NAMES],
        })
        const nextMessages: StoredChatMessage[] = [
          ...historyRef.current,
          { role: 'user', content: text },
          { role: 'assistant', content: answer },
        ]
        historyRef.current = nextMessages.slice(-20)
        await sendTelegramMessage(token, authorizedChatId, answer)
        state.onLibraryChanged()
      } catch (error) {
        await sendTelegramMessage(token, authorizedChatId, error instanceof Error ? error.message : 'No se pudo completar la consulta.')
      } finally { busyRef.current = false }
    }

    const handleUpdate = async (update: TelegramUpdate) => {
      const state = currentRef.current
      const peer = state.telegram.authorizedPeer
      if (!peer || update.chatId !== peer.chatId || update.user.id !== peer.userId) {
        if (update.text?.trim() === '/start') {
          updateTelegram({ ...state.telegram, pendingPeer: { chatId: update.chatId, userId: update.user.id, displayName: update.user.displayName, username: update.user.username ?? '' } })
          await sendTelegramMessage(state.telegram.botToken, update.chatId, 'Solicitud recibida. Autorizala desde Configuraciones → Telegram en Notia.')
        }
        return
      }
      if (update.callbackQueryId) await answerTelegramCallback(state.telegram.botToken, update.callbackQueryId)
      if (update.callbackData?.startsWith('confirm:')) {
        const [, id, decision] = update.callbackData.split(':')
        const resolveConfirmation = confirmationRef.current.get(id)
        if (resolveConfirmation) {
          resolveConfirmation(decision === 'yes')
          await sendTelegramMessage(state.telegram.botToken, peer.chatId, decision === 'yes' ? 'Confirmacion recibida. Aplicando el cambio...' : 'Operacion cancelada.')
        }
        return
      }
      if (update.callbackData?.startsWith('choice:')) {
        const selected = choicesRef.current[Number(update.callbackData.slice('choice:'.length))]
        if (selected && pendingInputRef.current) pendingInputRef.current.resolve(selected)
        return
      }
      let text = update.text?.trim()
      if (!text && update.audio) {
        try {
          text = (await transcribeTelegramAudio(state.telegram.botToken, update.audio)).trim()
        } catch (error) {
          await sendTelegramMessage(
            state.telegram.botToken,
            peer.chatId,
            error instanceof Error ? error.message : 'No se pudo transcribir el audio recibido.',
          )
          return
        }
        const acknowledgementText = Array.from(text).slice(0, 3_000).join('')
        await sendTelegramMessage(
          state.telegram.botToken,
          peer.chatId,
          `Solicitud <b>${escapeTelegramHtml(acknowledgementText)}</b> recibida y en proceso.`,
          [],
          'HTML',
        )
      }
      if (!text) return
      if (confirmationRef.current.size === 1) {
        const decision = parseTelegramConfirmationDecision(text)
        if (decision !== null) {
          const resolveConfirmation = confirmationRef.current.values().next().value
          resolveConfirmation?.(decision)
          await sendTelegramMessage(state.telegram.botToken, peer.chatId, decision ? 'Confirmacion recibida. Aplicando el cambio...' : 'Operacion cancelada.')
          return
        }
      }
      if (pendingInputRef.current) { pendingInputRef.current.resolve(text); return }
      if (!update.audio) {
        await sendTelegramMessage(
          state.telegram.botToken,
          peer.chatId,
          'Solicitud recibida y en proceso.',
        )
      }
      void runAgent(text)
    }

    const loop = async () => {
      while (!cancelled) {
        try {
          const updates = await pollTelegramUpdates(token, offset)
          if (cancelled) break
          for (const update of updates) {
            offset = Math.max(offset, update.updateId + 1)
            await handleUpdate(update)
          }
          if (offset !== currentRef.current.telegram.updateOffset) updateTelegram({ ...currentRef.current.telegram, updateOffset: offset })
        } catch { await new Promise((resolve) => window.setTimeout(resolve, 3000)) }
      }
    }
    void loop()
    return () => { cancelled = true }
  }, [authorizedChatIdValue, authorizedUserId, libraryId, telegramEnabled, telegramToken])
}
