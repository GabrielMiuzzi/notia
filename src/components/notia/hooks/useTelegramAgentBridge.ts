import { useEffect, useRef } from 'react'
import type { AiPreferences } from '../../../services/preferences/aiSettingsStorage'
import type { TelegramPreferences } from '../../../services/preferences/telegramSettingsStorage'
import { loadTelegramUpdateCheckpoint, mergeTelegramUpdateCheckpoint, rememberTelegramUpdate, saveTelegramUpdateCheckpoint } from '../../../services/preferences/telegramSettingsStorage'
import type { NotiaLibrary } from '../../../types/notia'
import { createChatScopedAgent } from '../../../services/chat/chatScopedAgentRuntime'
import { runNotiaChatReply } from '../../../services/chat/notiaChatRuntime'
import { loadSelectedAgentPromptFileName } from '../../../services/ai/agentPromptRuntime'
import type { StoredChatMessage } from '../../../services/chat/chatDocumentStorage'
import { loadLibraryFileOptions } from '../../../services/chat/chatAttachmentRuntime'
import { answerTelegramCallback, downloadTelegramPhoto, extractTelegramPdf, pollTelegramUpdates, sendTelegramMessage, transcribeTelegramAudio, type TelegramDocument, type TelegramPhoto, type TelegramUpdate } from '../../../services/telegram/telegramRuntime'
import { formatTelegramMessage } from '../../../services/telegram/telegramMessageFormatter'
import { scheduleLongTermMemoriesForTurn } from '../../../services/chat/chatLongTermMemorySync'
import { loadAgentMemories } from '../../../services/ai/agentPromptRuntime'
import type { AiImageAttachment } from '../../../services/ai/aiRuntime'
import { notiaLog, TELEGRAM_AI_DIAGNOSTIC_MODULE } from '../../../services/runtime/notiaLogger'

interface Params {
  library: NotiaLibrary | null
  aiPreferences: AiPreferences
  telegram: TelegramPreferences
  onTelegramChange: (value: TelegramPreferences) => void
  onLibraryChanged: () => void
}

interface PendingInput { resolve: (value: string) => void; reject: (error: Error) => void }
type TelegramAgentScope = 'finance' | 'library'
interface TelegramAgentRequest {
  text: string
  actorUserId: number
  scope: TelegramAgentScope
  attachment: { kind: 'photo'; value: TelegramPhoto } | { kind: 'pdf'; value: TelegramDocument } | null
}

export const TELEGRAM_CONFIRMATION_TIMEOUT_MS = 2 * 60 * 1_000
export const TELEGRAM_PENDING_REQUEST_LIMIT = 10
export const TELEGRAM_AI_TOOL_CALL_TIMEOUT_MS = 90_000
export const TELEGRAM_IMAGE_AI_MAX_ROUNDS = 12
export const TELEGRAM_IMAGE_PROGRESS_INTERVAL_MS = 12_000

export function buildTelegramImageRoundMessage(round: number): string | null {
  if (round === 2) return 'Documento leído. Estoy consultando los datos financieros necesarios…'
  if (round === 3) return 'Datos recibidos. Estoy preparando el registro…'
  if (round >= 4) return `Estoy validando y guardando el documento (paso ${round - 2})…`
  return null
}

export function buildTelegramFinanceSourceReference(fileId: string, extension = 'jpg'): string {
  return `telegram:telegram-${fileId}.${extension}`
}

export function describeTelegramAgentError(error: unknown, fallback = 'No se pudo completar la consulta.'): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim()
  if (typeof error === 'string' && error.trim()) return error.trim()
  if (typeof error === 'object' && error !== null) {
    const errorPayload = error as Record<string, unknown>
    for (const key of ['message', 'error'] as const) {
      const value = errorPayload[key]
      if (typeof value === 'string' && value.trim()) return value.trim()
    }
    try {
      const serialized = JSON.stringify(error)
      if (serialized && serialized !== '{}') return serialized.slice(0, 500)
    } catch {
      // Preserve the safe generic error when the native payload is not serializable.
    }
  }
  return fallback
}

/** Adds an update without losing its order; the active request is tracked separately. */
export function enqueueTelegramAgentRequest<T>(queue: T[], request: T, limit = TELEGRAM_PENDING_REQUEST_LIMIT): number | null {
  if (queue.length >= limit) return null
  const queuedAhead = queue.length
  queue.push(request)
  return queuedAhead
}

export function isTelegramFinanceRequest(value: string): boolean {
  const normalized = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es')
  const financeTerms = /\b(finanzas?|financier[oa]s?|gast(?:o|os|e|aste|amos|ar)|pague|pagaste|pago|cobre|cobraste|cobro|ingreso|ingresos|saldo|saldos|cuenta|cuentas|categoria|categorias|ahorro|ahorros|retiro|aporte|transferencia|movimiento|movimientos|sueldo|ticket|precio|nafta|combustible)\b/
  if (financeTerms.test(normalized)) return true
  const moneyAmount = /(?:\$\s*\d|\b\d+(?:[.,]\d{1,2})?\s*(?:ars|usd|pesos?)\b)/
  const financeVerb = /\b(carg(?:a|ue|aste|amos|ar|ado)|anot(?:a|alo|arla|ar|e|aste|amos|ado)|registr(?:a|alo|arla|ar|e|aste|amos|ado))\b/
  return moneyAmount.test(normalized) && financeVerb.test(normalized)
}

export function resolveTelegramAgentScope(value: string, previousScope: TelegramAgentScope | null): TelegramAgentScope {
  const normalized = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es')
  const explicitLibraryRequest = /\b(nota|notas|documento|documentos|archivo|archivos|biblioteca|carpeta|carpetas|tarea|tareas|tablero|board)\b/.test(normalized)
  if (explicitLibraryRequest) return 'library'
  if (isTelegramFinanceRequest(value)) return 'finance'
  return previousScope === 'finance' && !explicitLibraryRequest ? 'finance' : 'library'
}

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

/** Resolves a typed 1-based reply against the same choices shown as Telegram buttons. */
export function resolveTelegramChoiceReply(value: string, choices: readonly string[]): string {
  const match = /^(\d+)\s*[.)]?$/.exec(value.trim())
  if (!match) return value
  const index = Number(match[1]) - 1
  return Number.isSafeInteger(index) && choices[index] !== undefined ? choices[index] : value
}

const escapeTelegramHtml = (value: string): string => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')

export function useTelegramAgentBridge({ library, aiPreferences, telegram, onTelegramChange, onLibraryChanged }: Params): void {
  const currentRef = useRef({ library, aiPreferences, telegram, onTelegramChange, onLibraryChanged })
  const historyRef = useRef<StoredChatMessage[]>([])
  const busyRef = useRef(false)
  const pendingRequestsRef = useRef<TelegramAgentRequest[]>([])
  const drainingRequestsRef = useRef(false)
  const pendingFinanceSourceReferenceRef = useRef<string | null>(null)
  const pendingInputRef = useRef<PendingInput | null>(null)
  const confirmationRef = useRef<Map<string, (accepted: boolean) => void>>(new Map())
  const choicesRef = useRef<string[]>([])
  const conversationScopeRef = useRef<TelegramAgentScope | null>(null)
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
    conversationScopeRef.current = null
    pendingRequestsRef.current = []
    drainingRequestsRef.current = false
    pendingFinanceSourceReferenceRef.current = null
  }, [libraryId])

  useEffect(() => {
    const activeLibrary = currentRef.current.library
    if (!activeLibrary || !telegramEnabled || !telegramToken) return
    const token = telegramToken
    const authorizedChatId = authorizedChatIdValue
    const checkpointScope = `${activeLibrary.id}:${token.split(':', 1)[0] ?? 'bot'}:${authorizedChatId}`
    let cancelled = false
    const updateTelegram = (next: TelegramPreferences) => {
      currentRef.current = { ...currentRef.current, telegram: next }
      currentRef.current.onTelegramChange(next)
    }
    const checkpointedTelegram = mergeTelegramUpdateCheckpoint(
      currentRef.current.telegram,
      loadTelegramUpdateCheckpoint(checkpointScope),
    )
    let offset = checkpointedTelegram.updateOffset
    if (
      checkpointedTelegram.updateOffset !== currentRef.current.telegram.updateOffset
      || checkpointedTelegram.processedUpdateIds.length !== currentRef.current.telegram.processedUpdateIds.length
    ) {
      updateTelegram(checkpointedTelegram)
    }

    const waitForText = (question: string, choices: string[], signal: AbortSignal): Promise<string> => {
      choicesRef.current = choices
      void sendTelegramMessage(
        token,
        authorizedChatId,
        formatTelegramMessage(question),
        choices.map((choice, index) => ({ label: choice.slice(0, 48), data: `choice:${index}` })),
        'HTML',
      )
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

    const runAgent = async (request: TelegramAgentRequest) => {
      const state = currentRef.current
      if (!state.library) return
      busyRef.current = true
      const requestStartedAt = performance.now()
      let lastImageProgressAt = 0
      let phase = 'preparing'
      try {
        let text = request.text
        let image: AiImageAttachment | null = null
        let financeSourceReference = pendingFinanceSourceReferenceRef.current
        if (request.attachment) {
          phase = request.attachment.kind === 'photo' ? 'downloading-image' : 'extracting-pdf'
          if (request.attachment.kind === 'pdf') {
            const downloaded = await extractTelegramPdf(state.telegram.botToken, request.attachment.value)
            financeSourceReference = buildTelegramFinanceSourceReference(downloaded.fileId, 'pdf')
            pendingFinanceSourceReferenceRef.current = financeSourceReference
            text = `${text ? `${text}\n\n` : ''}[Origen: PDF de Telegram fileId=${downloaded.fileId}. Contenido extraído por el extractor documental: ${downloaded.extractedContent}] Clasifica el documento como recibo de sueldo, resumen de tarjeta de crédito, ticket u otro y usa la herramienta financiera correspondiente.`
          } else {
          const downloadStartedAt = performance.now()
          notiaLog(TELEGRAM_AI_DIAGNOSTIC_MODULE, 'image processing started', {
            scope: request.scope,
            width: request.attachment.value.width,
            height: request.attachment.value.height,
            fileSize: request.attachment.value.fileSize,
          }, 'info')
          const downloaded = await downloadTelegramPhoto(state.telegram.botToken, request.attachment.value)
          notiaLog(TELEGRAM_AI_DIAGNOSTIC_MODULE, 'image download completed', {
            durationMs: Math.round(performance.now() - downloadStartedAt),
            mimeType: downloaded.mimeType,
            base64Chars: downloaded.base64.length,
          }, 'info')
          image = { name: `telegram-${downloaded.fileId}.jpg`, mimeType: downloaded.mimeType, base64: downloaded.base64 }
          financeSourceReference = buildTelegramFinanceSourceReference(downloaded.fileId)
          pendingFinanceSourceReferenceRef.current = financeSourceReference
          text = text || `[Origen: imagen de Telegram fileId=${downloaded.fileId}. Clasifica el documento como ticket de compra, recibo de sueldo, resumen de tarjeta de crédito u otro. Si es ticket, extrae comercio, fecha, moneda, total y productos. Si es recibo de sueldo, extrae período, fecha de cobro, empleador, bruto, descuentos, neto, moneda y conceptos. Si es un resumen de tarjeta, extrae emisor, últimos cuatro dígitos, período, cierre, vencimiento, moneda, saldo anterior, pagos, créditos, compras, cargos, intereses, impuestos, total, pago mínimo y todas las líneas.]`
          }
        }
        phase = 'building-agent'
        const agentBuildStartedAt = performance.now()
        notiaLog(TELEGRAM_AI_DIAGNOSTIC_MODULE, 'agent context build started', undefined, 'info')
        const files = await loadLibraryFileOptions(state.library)
        const agent = await createChatScopedAgent({
          scope: request.scope, library: state.library, scopePaths: files.map((file) => file.path), actorUserId: request.actorUserId,
          aiPreferences: state.aiPreferences,
          promptFileName: loadSelectedAgentPromptFileName(state.library.id),
          responseFormat: 'telegram-html',
          financeSourceReference,
          onFinancePurchaseSaved: (sourceReference) => {
            if (pendingFinanceSourceReferenceRef.current === sourceReference) pendingFinanceSourceReferenceRef.current = null
          },
          onFinanceSalarySaved: (sourceReference) => {
            if (pendingFinanceSourceReferenceRef.current === sourceReference) pendingFinanceSourceReferenceRef.current = null
          },
          onFinanceCreditCardStatementSaved: (sourceReference) => {
            if (pendingFinanceSourceReferenceRef.current === sourceReference) pendingFinanceSourceReferenceRef.current = null
          },
          requestClarification: (question, signal, choices = []) => waitForText(question, choices, signal),
          requestConfirmation: confirm,
          requestExecutionPlanApproval: async (steps, signal) => ({
            approved: await confirm(
              `Aprobar este plan de ejecucion:\n${steps.map((step, index) => `${index + 1}. ${step.label}`).join('\n')}`,
              signal,
            ),
          }),
        })
        notiaLog(TELEGRAM_AI_DIAGNOSTIC_MODULE, 'agent context build completed', {
          durationMs: Math.round(performance.now() - agentBuildStartedAt),
          libraryFileCount: files.length,
          toolCount: agent.tools.length,
        }, 'info')
        phase = 'running-ollama'
        const answer = await runNotiaChatReply(state.aiPreferences, {
          agent,
          prompt: text,
          image,
          previousMessages: historyRef.current,
          toolCallTimeoutMs: TELEGRAM_AI_TOOL_CALL_TIMEOUT_MS,
          streamFinalResponse: false,
          maxRounds: request.attachment ? TELEGRAM_IMAGE_AI_MAX_ROUNDS : undefined,
          diagnosticModule: request.attachment ? TELEGRAM_AI_DIAGNOSTIC_MODULE : undefined,
        }, {
          onAgentRoundStart: (round) => {
            if (!request.attachment) return
            const progressMessage = buildTelegramImageRoundMessage(round)
            if (!progressMessage) return
            const now = performance.now()
            if (round > 4 && now - lastImageProgressAt < TELEGRAM_IMAGE_PROGRESS_INTERVAL_MS) return
            lastImageProgressAt = now
            void sendTelegramMessage(token, authorizedChatId, progressMessage).catch((error) => {
              notiaLog(TELEGRAM_AI_DIAGNOSTIC_MODULE, 'telegram progress message failed', {
                round,
                error: error instanceof Error ? error.message : String(error),
              }, 'error')
            })
          },
        })
        notiaLog(TELEGRAM_AI_DIAGNOSTIC_MODULE, 'telegram answer ready', {
          durationMs: Math.round(performance.now() - requestStartedAt),
          answerChars: answer.length,
        }, 'info')
        const previousMessages = historyRef.current
        const nextMessages: StoredChatMessage[] = [
          ...historyRef.current,
          { role: 'user', content: text },
          { role: 'assistant', content: answer },
        ]
        historyRef.current = nextMessages.slice(-20)
        void loadAgentMemories(state.library).then((existingLongTermMemories) => {
          scheduleLongTermMemoriesForTurn({
            library: state.library as NotiaLibrary,
            aiPreferences: state.aiPreferences,
            prompt: text,
            assistantReply: answer,
            previousMessages,
            existingLongTermMemories,
          })
        })
        phase = 'sending-response'
        await sendTelegramMessage(token, authorizedChatId, formatTelegramMessage(answer), [], 'HTML')
        notiaLog(TELEGRAM_AI_DIAGNOSTIC_MODULE, 'telegram answer sent', {
          durationMs: Math.round(performance.now() - requestStartedAt),
        }, 'info')
        state.onLibraryChanged()
      } catch (error) {
        const message = describeTelegramAgentError(error)
        notiaLog(TELEGRAM_AI_DIAGNOSTIC_MODULE, 'agent request failed', {
          phase,
          scope: request.scope,
          hasPhoto: Boolean(request.attachment),
          durationMs: Math.round(performance.now() - requestStartedAt),
          error: message,
        }, 'error')
        await sendTelegramMessage(token, authorizedChatId, message)
      } finally { busyRef.current = false }
    }

    const drainAgentRequests = async () => {
      if (drainingRequestsRef.current) return
      drainingRequestsRef.current = true
      try {
        while (!cancelled) {
          const request = pendingRequestsRef.current.shift()
          if (!request) return
          await runAgent(request)
        }
      } finally {
        drainingRequestsRef.current = false
      }
    }

    const enqueueAgentRequest = (request: TelegramAgentRequest): number | null => {
      const queuedAhead = enqueueTelegramAgentRequest(pendingRequestsRef.current, request)
      if (queuedAhead === null) return null
      const requestsAhead = queuedAhead + (busyRef.current ? 1 : 0)
      void drainAgentRequests()
      return requestsAhead
    }

    const handleUpdate = async (update: TelegramUpdate) => {
      const state = currentRef.current
      if (!state.library) return
      const peer = state.telegram.authorizedPeer
      if (!peer || update.chatId !== peer.chatId || update.user.id !== peer.userId) {
        if (update.text?.trim() === '/start') {
          updateTelegram({ ...state.telegram, pendingPeer: { chatId: update.chatId, userId: update.user.id, displayName: update.user.displayName, username: update.user.username ?? '' } })
          await sendTelegramMessage(state.telegram.botToken, update.chatId, 'Solicitud recibida. Autorizala desde Configuraciones → Telegram en Notia.')
        }
        return
      }
      if (state.telegram.processedUpdateIds.includes(update.updateId)) return
      const checkpointedUpdate = rememberTelegramUpdate({
        ...state.telegram,
        updateOffset: Math.max(state.telegram.updateOffset, update.updateId + 1),
      }, update.updateId)
      saveTelegramUpdateCheckpoint(checkpointScope, checkpointedUpdate)
      updateTelegram(checkpointedUpdate)
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
          const transcription = (await transcribeTelegramAudio(state.telegram.botToken, update.audio)).trim()
          text = `${transcription}\n\n[Origen: audio de Telegram fileId=${update.audio.fileId}; conservar esta referencia si se crea una operación financiera.]`
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
      if (!text && !update.photo && !update.document) return
      const plainText = text ?? ''
      if (!update.photo && !update.document && confirmationRef.current.size === 1) {
        const decision = parseTelegramConfirmationDecision(plainText)
        if (decision !== null) {
          const resolveConfirmation = confirmationRef.current.values().next().value
          resolveConfirmation?.(decision)
          await sendTelegramMessage(state.telegram.botToken, peer.chatId, decision ? 'Confirmacion recibida. Aplicando el cambio...' : 'Operacion cancelada.')
          return
        }
      }
      if (!update.photo && !update.document && pendingInputRef.current) {
        pendingInputRef.current.resolve(resolveTelegramChoiceReply(plainText, choicesRef.current))
        return
      }
      const attachment = update.photo
        ? { kind: 'photo' as const, value: update.photo }
        : update.document
          ? { kind: 'pdf' as const, value: update.document }
          : null
      const prompt = text || (attachment ? '[Origen: documento de Telegram. Clasifica el documento como ticket de compra, recibo de sueldo, resumen de tarjeta de crédito u otro. Extrae todos los campos financieros legibles del tipo detectado y usa la herramienta de registro correspondiente.]' : '')
      const scope = attachment ? 'finance' : resolveTelegramAgentScope(prompt, conversationScopeRef.current)
      if (attachment) {
        notiaLog(TELEGRAM_AI_DIAGNOSTIC_MODULE, 'telegram image received', {
          updateId: update.updateId,
          messageId: update.messageId,
          width: update.photo?.width,
          height: update.photo?.height,
          fileSize: update.photo?.fileSize ?? update.document?.fileSize,
          pendingRequests: pendingRequestsRef.current.length,
        }, 'info')
      }
      const requestsAhead = enqueueAgentRequest({ text: prompt, actorUserId: peer.userId, scope, attachment })
      if (requestsAhead === null) {
        await sendTelegramMessage(state.telegram.botToken, peer.chatId, 'No puedo aceptar mas de 10 solicitudes pendientes. Espera a que termine alguna e intenta nuevamente.')
        return
      }
      if (!update.audio) {
        await sendTelegramMessage(
          state.telegram.botToken,
          peer.chatId,
          attachment
            ? requestsAhead > 0
              ? `Documento recibido. Quedo en cola despues de ${requestsAhead} solicitud${requestsAhead === 1 ? '' : 'es'}.`
              : 'Documento recibido y en proceso.'
            : requestsAhead > 0
              ? `Solicitud recibida. Quedo en cola despues de ${requestsAhead} solicitud${requestsAhead === 1 ? '' : 'es'}.`
              : 'Solicitud recibida y en proceso.',
        )
      }
      conversationScopeRef.current = scope
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
          if (offset !== currentRef.current.telegram.updateOffset) {
            const checkpointedOffset = { ...currentRef.current.telegram, updateOffset: offset }
            saveTelegramUpdateCheckpoint(checkpointScope, checkpointedOffset)
            updateTelegram(checkpointedOffset)
          }
        } catch { await new Promise((resolve) => window.setTimeout(resolve, 3000)) }
      }
    }
    void loop()
    return () => {
      cancelled = true
      pendingRequestsRef.current = []
    }
  }, [authorizedChatIdValue, authorizedUserId, libraryId, telegramEnabled, telegramToken])
}
