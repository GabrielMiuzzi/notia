import { useEffect, useRef } from 'react'
import type { AiPreferences } from '../../../services/preferences/aiSettingsStorage'
import type { TelegramPendingAgentRequestStatus, TelegramPreferences } from '../../../services/preferences/telegramSettingsStorage'
import { loadTelegramPendingAgentRequests, loadTelegramUpdateCheckpoint, mergeTelegramUpdateCheckpoint, rememberTelegramUpdate, saveTelegramPendingAgentRequests, saveTelegramUpdateCheckpoint, type TelegramAgentRequestScope, type TelegramPendingAgentRequest, type TelegramPersistedPlan } from '../../../services/preferences/telegramSettingsStorage'
import type { NotiaLibrary } from '../../../types/notia'
import { createChatScopedAgent } from '../../../services/chat/chatScopedAgentRuntime'
import { runNotiaChatReply } from '../../../services/chat/notiaChatRuntime'
import { loadSelectedAgentPromptFileName } from '../../../services/ai/agentPromptRuntime'
import type { StoredChatMessage } from '../../../services/chat/chatDocumentStorage'
import { loadLibraryFileOptions } from '../../../services/chat/chatAttachmentRuntime'
import { verifyFinanceSalaryPersistence } from '../../../modules/finance/services/financeService'
import type { FinanceSalaryReceipt } from '../../../modules/finance/types/financeTypes'
import { answerTelegramCallback, downloadTelegramPhoto, editTelegramMessage, extractTelegramPdf, pollTelegramUpdates, sendTelegramMessage, transcribeTelegramAudio, type TelegramUpdate } from '../../../services/telegram/telegramRuntime'
import type { MutationPreview } from '../../../types/ai/agentContracts'
import { scheduleLongTermMemoriesForTurn } from '../../../services/chat/chatLongTermMemorySync'
import { loadAgentMemories } from '../../../services/ai/agentPromptRuntime'
import type { AiImageAttachment } from '../../../services/ai/aiRuntime'
import { classifyWebSearchNeed } from '../../../services/ai/webSearchRuntime'
import type { AgentProgressEvent } from '../../../types/ai/agentContracts'
import { notiaLog, TELEGRAM_AI_DIAGNOSTIC_MODULE } from '../../../services/runtime/notiaLogger'
import { renderTelegramPdfPages } from '../../../services/telegram/telegramPdfRenderer'
import { buildTelegramProgressMessage, createTelegramProgressState, isCriticalTelegramProgressEvent, markTelegramProgressThinking, reduceTelegramProgress, shouldPublishTelegramProgress } from '../../../services/telegram/telegramProgressRuntime'
import { findLibraryUser, linkLibraryUserTelegram, resolveLibraryTelegramUser } from '../../../services/libraries/libraryUsers'

interface Params {
  library: NotiaLibrary | null
  aiPreferences: AiPreferences
  telegram: TelegramPreferences
  onTelegramChange: (value: TelegramPreferences) => void
  onLibraryChanged: () => void
}

interface PendingInput { resolve: (value: string) => void; reject: (error: Error) => void }
type TelegramAgentScope = TelegramAgentRequestScope
type TelegramAgentRequest = TelegramPendingAgentRequest

export const TELEGRAM_CONFIRMATION_TIMEOUT_MS = 2 * 60 * 1_000
export const TELEGRAM_PENDING_REQUEST_LIMIT = 10
export const TELEGRAM_AI_TOOL_CALL_TIMEOUT_MS = 90_000
export const TELEGRAM_IMAGE_AI_MAX_ROUNDS = 12
export const TELEGRAM_IMAGE_PROGRESS_INTERVAL_MS = 12_000
export const TELEGRAM_RECOVERY_COMMAND = '/reanudar'
export const TELEGRAM_MAX_PROGRESS_MESSAGE_RETRIES = 3
export const TELEGRAM_LINK_MAX_ATTEMPTS = 5
export const TELEGRAM_LINK_COOLDOWN_MS = 30_000

function createTelegramAgentRequestId(): string {
  return crypto.randomUUID().replaceAll('-', '').slice(0, 24)
}

function withTelegramRequestStatus(
  request: TelegramAgentRequest,
  status: TelegramPendingAgentRequestStatus,
): TelegramAgentRequest {
  return { ...request, status }
}

function plansMatch(left: TelegramPersistedPlan | undefined, right: TelegramPersistedPlan | undefined): boolean {
  if (!left || !right) return left === right
  return left.steps.length === right.steps.length
    && left.steps.every((step, index) => step.id === right.steps[index]?.id && step.status === right.steps[index]?.status)
}

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
  const redactSensitiveErrorDetails = (value: string): string => value
    .replace(/bearer\s+[a-z0-9._~+/=-]{8,}/gi, 'Bearer [oculto]')
    .replace(/\b(?:sk-[a-z0-9_-]{12,}|gh[pousr]_[a-z0-9_-]{12,}|xox[baprs]-[a-z0-9-]{12,}|akia[a-z0-9]{12,})\b/gi, '[secreto oculto]')
    .replace(/(api[_ -]?key|access[_ -]?token|password|passwd|secret|cookie)\s*[:=]\s*[^\s,;}]+/gi, '$1=[oculto]')
    .replace(/https?:\/\/[^\s/@]+:[^\s/@]+@/gi, 'https://[credenciales-ocultas]@')
    .replace(/(?:[A-Za-z]:[\\/]|\/(?:Users|home|private|appdata|documents)[\\/])[^\s"']+/gi, '[ruta privada]')

  const safe = (value: string): string => redactSensitiveErrorDetails(value).slice(0, 500)
  if (error instanceof Error && error.message.trim()) return safe(error.message.trim())
  if (typeof error === 'string' && error.trim()) return safe(error.trim())
  if (typeof error === 'object' && error !== null) {
    const errorPayload = error as Record<string, unknown>
    for (const key of ['message', 'error'] as const) {
      const value = errorPayload[key]
      if (typeof value === 'string' && value.trim()) return safe(value.trim())
    }
  }
  return fallback
}

export function buildTelegramConfirmationMessage(question: string, preview?: MutationPreview): string {
  const redactDetail = (value: string): string => value
    .replace(/\boperationId\s*[:=]\s*[^\s,;]+/gi, 'operationId=[oculto]')
    .replace(/((?:api[_ -]?key|access[_ -]?token|password|passwd|secret|cookie))\s*[:=]\s*[^\s,;}]+/gi, '$1=[oculto]')
    .replace(/(?:[A-Za-z]:[\\/]|\/(?:Users|home|private|appdata|documents)[\\/])[^\s"']+/gi, '[ruta privada]')
    .trim()

  const detail = preview
    ? [
      preview.summary.trim(),
      `Documentos afectados: ${preview.documents.length}. Cambios preparados: ${preview.hunks.length}.`,
      ...(preview.risks.length > 0 ? [`Riesgo: ${preview.risks.slice(0, 2).join(' ')}`] : []),
    ].filter(Boolean).join('\n')
    : redactDetail(question)
  const boundedDetail = detail.length > 3_000 ? `${detail.slice(0, 3_000)}\n…` : detail
  return `Confirmación requerida:\n\n${boundedDetail || 'La IA preparó una operación.'}\n\nRespondé Confirmar para ejecutar o Cancelar para detenerla.`
}

/** Adds an update without losing its order; the active request is tracked separately. */
export function enqueueTelegramAgentRequest<T>(queue: T[], request: T, limit = TELEGRAM_PENDING_REQUEST_LIMIT): number | null {
  if (queue.length >= limit) return null
  const queuedAhead = queue.length
  queue.push(request)
  return queuedAhead
}

export function preserveInterruptedTelegramRequest(
  interruptedRequests: readonly TelegramAgentRequest[],
  activeRequest: TelegramAgentRequest,
): TelegramAgentRequest[] {
  if (interruptedRequests.some((request) => request.requestId === activeRequest.requestId)) {
    return [...interruptedRequests]
  }
  return [...interruptedRequests, withTelegramRequestStatus(activeRequest, 'interrupted')]
}

export function isTelegramFinanceRequest(value: string): boolean {
  const normalized = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es')
  const financeTerms = /\b(finanzas?|financier[oa]s?|gast(?:o|os|e|aste|amos|ar)|pague|pagaste|pago|cobre|cobraste|cobro|ingreso|ingresos|saldo|saldos|cuenta|cuentas|categoria|categorias|ahorro|ahorros|retiro|aporte|transferencia|movimiento|movimientos|sueldo|ticket|precio|nafta|combustible|cotizacion(?:es)?|dolar(?:es)?|inflacion|ipc|oficial|blue)\b/
  if (financeTerms.test(normalized)) return true
  const moneyAmount = /(?:\$\s*\d|\b\d+(?:[.,]\d{1,2})?\s*(?:ars|usd|pesos?)\b)/
  const financeVerb = /\b(carg(?:a|ue|aste|amos|ar|ado)|anot(?:a|alo|arla|ar|e|aste|amos|ado)|registr(?:a|alo|arla|ar|e|aste|amos|ado))\b/
  return moneyAmount.test(normalized) && financeVerb.test(normalized)
}

export function isTelegramCurrentNewsRequest(value: string): boolean {
  const normalized = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es')
  const asksForNews = /\b(notici(?:a|as)|novedad(?:es)?|actualidad|panorama)\b/.test(normalized)
  return asksForNews && classifyWebSearchNeed(value) !== 'none'
}

export function isTelegramPublicWebRequest(value: string): boolean {
  const normalized = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es')
  const publicSourceTerm = /\b(en internet|en la web|fuente(?:s)?|enlace(?:s)?|link(?:s)?|url(?:s)?)\b/.test(normalized)
  return publicSourceTerm && classifyWebSearchNeed(value) === 'explicit'
}

export function resolveTelegramAgentScope(value: string, previousScope: TelegramAgentScope | null): TelegramAgentScope {
  // Telegram is a channel over the whole active library, not a mirror of the
  // module currently selected in the desktop UI. Keep this resolver for the
  // persisted request contract, but never narrow a request to Finance here:
  // the agent receives library/task tools plus the finance toolset below.
  void value
  void previousScope
  return 'library'
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

export function isUnverifiedTelegramSalarySuccess(answer: string, savedSalary: FinanceSalaryReceipt | null): boolean {
  return !savedSalary && /^Listo\. Registré el recibo de sueldo\b/i.test(answer.trim())
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
  const interruptedRequestsRef = useRef<TelegramAgentRequest[]>([])
  const activeRequestRef = useRef<TelegramAgentRequest | null>(null)
  const drainingRequestsRef = useRef(false)
  const pendingFinanceSourceReferenceRef = useRef<string | null>(null)
  const pendingInputRef = useRef<PendingInput | null>(null)
  const confirmationRef = useRef<Map<string, (accepted: boolean) => void>>(new Map())
  const progressPublisherRef = useRef<((event: AgentProgressEvent) => void) | null>(null)
  const choicesRef = useRef<string[]>([])
  const conversationScopeRef = useRef<TelegramAgentScope | null>(null)
  const libraryId = library?.id
  const telegramEnabled = telegram.enabled
  const telegramToken = telegram.botToken
  const authorizedChatIdValue = import.meta.env.MODE === 'test' ? telegram.authorizedPeer?.chatId ?? 0 : 0
  const authorizedUserId = import.meta.env.MODE === 'test' ? telegram.authorizedPeer?.userId ?? 0 : 0
  currentRef.current = { library, aiPreferences, telegram, onTelegramChange, onLibraryChanged }

  useEffect(() => {
    historyRef.current = []
    pendingInputRef.current?.reject(new Error('La biblioteca activa cambio.'))
    pendingInputRef.current = null
    confirmationRef.current.clear()
    conversationScopeRef.current = null
    pendingRequestsRef.current = []
    interruptedRequestsRef.current = []
    activeRequestRef.current = null
    progressPublisherRef.current = null
    drainingRequestsRef.current = false
    pendingFinanceSourceReferenceRef.current = null
  }, [libraryId])

  useEffect(() => {
    const activeLibrary = currentRef.current.library
    if (!activeLibrary || !telegramEnabled || !telegramToken) return
    const token = telegramToken
    let authorizedChatId = authorizedChatIdValue
    const checkpointScope = `${activeLibrary.id}:${token.split(':', 1)[0] ?? 'bot'}:${authorizedChatId}`
    const storedRequests = loadTelegramPendingAgentRequests(checkpointScope)
      .map((request) => request.requestId ? request : { ...request, requestId: createTelegramAgentRequestId() })
    interruptedRequestsRef.current = storedRequests.filter((request) => request.status === 'interrupted')
    pendingRequestsRef.current = storedRequests
      .filter((request) => request.status !== 'interrupted')
      .map((request) => withTelegramRequestStatus(request, 'queued'))
    activeRequestRef.current = null
    let cancelled = false
    let activeAbortController: AbortController | null = null
    type TelegramLinkFlow = { step: 'username' | 'new-password' | 'confirm-password' | 'existing-password', userId?: string, password?: string, expiresAt: number, attempts: number, blockedUntil?: number }
    const linkFlows = new Map<number, TelegramLinkFlow>()
    const libraryDatabaseContext = () => ({ libraryPath: currentRef.current.library?.path ?? '', androidDirectoryUri: currentRef.current.library?.androidTreeUri })
    const persistAgentRequests = () => {
      const requests = activeRequestRef.current
        ? [activeRequestRef.current, ...interruptedRequestsRef.current, ...pendingRequestsRef.current]
        : [...interruptedRequestsRef.current, ...pendingRequestsRef.current]
      if (!saveTelegramPendingAgentRequests(checkpointScope, requests)) {
        notiaLog(TELEGRAM_AI_DIAGNOSTIC_MODULE, 'telegram queue persistence failed', {
          pendingRequests: requests.length,
        }, 'error')
      }
    }
    const interruptActiveRequest = () => {
      activeAbortController?.abort()
      activeAbortController = null
      const activeRequest = activeRequestRef.current
      if (!activeRequest) return
      interruptedRequestsRef.current = preserveInterruptedTelegramRequest(interruptedRequestsRef.current, activeRequest)
      activeRequestRef.current = null
      persistAgentRequests()
    }
    const cancelOnVisibilityChange = () => {
      if (document.visibilityState === 'hidden') interruptActiveRequest()
    }
    document.addEventListener('visibilitychange', cancelOnVisibilityChange)
    if (interruptedRequestsRef.current.length > 0) {
      const count = interruptedRequestsRef.current.length
      void sendTelegramMessage(
        token,
        authorizedChatId,
        `${count === 1 ? 'Tengo una solicitud' : `Tengo ${count} solicitudes`} interrumpida${count === 1 ? '' : 's'} con estado desconocido. Escribi ${TELEGRAM_RECOVERY_COMMAND} si queres reanudarla${count === 1 ? '' : 's'}; no la voy a repetir automaticamente.`,
      )
    }
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
      progressPublisherRef.current?.({ type: 'clarification-required', clarificationId: null })
      void sendTelegramMessage(
        token,
        authorizedChatId,
        question,
        choices.map((choice, index) => ({ label: choice.slice(0, 48), data: `choice:${index}` })),
        'HTML',
      )
      return new Promise((resolve, reject) => {
        const abort = () => reject(new Error('Operación cancelada.'))
        signal.addEventListener('abort', abort, { once: true })
        pendingInputRef.current = {
          resolve: (answer) => {
            signal.removeEventListener('abort', abort)
            pendingInputRef.current = null
            progressPublisherRef.current?.({ type: 'phase-changed', phase: 'executing', round: null })
            resolve(answer)
          },
          reject,
        }
      })
    }

    const confirm = (question: string, signal: AbortSignal, preview?: MutationPreview): Promise<boolean> => {
      const id = crypto.randomUUID().slice(0, 8)
      progressPublisherRef.current?.({ type: 'confirmation-required', operationId: null })
      void sendTelegramMessage(token, authorizedChatId, buildTelegramConfirmationMessage(question, preview), [
        { label: 'Confirmar', data: `confirm:${id}:yes` }, { label: 'Cancelar', data: `confirm:${id}:no` },
      ])
      return new Promise((resolve, reject) => {
        const timeoutId = window.setTimeout(() => {
          confirmationRef.current.delete(id)
          resolve(false)
          void sendTelegramMessage(token, authorizedChatId, 'La confirmación venció después de 2 minutos. No se aplicaron cambios.')
        }, TELEGRAM_CONFIRMATION_TIMEOUT_MS)
        const abort = () => {
          window.clearTimeout(timeoutId)
          confirmationRef.current.delete(id)
          reject(new Error('Operación cancelada.'))
        }
        signal.addEventListener('abort', abort, { once: true })
        confirmationRef.current.set(id, (accepted) => {
          window.clearTimeout(timeoutId)
          signal.removeEventListener('abort', abort)
          confirmationRef.current.delete(id)
          progressPublisherRef.current?.({ type: 'phase-changed', phase: 'executing', round: null })
          resolve(accepted)
        })
      })
    }

    const runAgent = async (request: TelegramAgentRequest) => {
      const state = currentRef.current
      if (!state.library) return
      const abortController = new AbortController()
      activeAbortController = abortController
      busyRef.current = true
      const requestStartedAt = performance.now()
      let phase = 'preparing'
      let savedSalary: FinanceSalaryReceipt | null = null
      let progressState = createTelegramProgressState(pendingRequestsRef.current.length)
      let progressMessageId: number | null = request.progressMessageId ?? null
      let progressMessageRetryCount = request.progressMessageRetryCount ?? 0
      let progressPublishingDisabled = progressMessageRetryCount >= TELEGRAM_MAX_PROGRESS_MESSAGE_RETRIES
      let terminalProgressFallbackSent = false
      let lastProgressPublishedAt: number | null = null
      let lastProgressMessage: string | null = null
      let progressRequestId: string | null = null
      let lastProgressTimestamp = 0
      let progressUpdateQueue: Promise<void> = Promise.resolve()
      const publishProgress = (event: AgentProgressEvent): void => {
        if (event.requestId) {
          if (progressRequestId && progressRequestId !== event.requestId) return
          progressRequestId = event.requestId
        }
        if (event.timestamp !== undefined) {
          if (event.timestamp < lastProgressTimestamp) return
          lastProgressTimestamp = event.timestamp
        }
        progressState = reduceTelegramProgress(progressState, event)
        const persistedPlan: TelegramPersistedPlan | undefined = progressState.plan
          ? { steps: progressState.plan.steps.map((step) => ({ id: step.id, status: step.status })) }
          : undefined
        const activeRequest = activeRequestRef.current
        if (activeRequest && activeRequest.requestId === request.requestId && !plansMatch(activeRequest.plan, persistedPlan)) {
          activeRequestRef.current = {
            ...activeRequest,
            ...(persistedPlan ? { plan: persistedPlan } : { plan: undefined }),
          }
          persistAgentRequests()
        }
        const now = performance.now()
        const critical = isCriticalTelegramProgressEvent(event)
        const message = buildTelegramProgressMessage(progressState, state.aiPreferences)
        if (!message) return
        if (progressPublishingDisabled && (!critical || terminalProgressFallbackSent)) return
        if (message === lastProgressMessage) return
        if (!shouldPublishTelegramProgress(lastProgressPublishedAt, now, critical)) return
        lastProgressPublishedAt = now
        lastProgressMessage = message
        progressUpdateQueue = progressUpdateQueue.then(async () => {
          if (progressPublishingDisabled) {
            terminalProgressFallbackSent = true
            progressMessageId = await sendTelegramMessage(token, authorizedChatId, message, [], 'HTML')
          } else if (progressMessageId === null || !state.aiPreferences.editProgressMessage) {
            progressMessageId = await sendTelegramMessage(token, authorizedChatId, message, [], 'HTML')
            progressMessageRetryCount = 0
          } else {
            await editTelegramMessage(token, authorizedChatId, progressMessageId, message, [], 'HTML')
            progressMessageRetryCount = 0
          }
          const activeRequest = activeRequestRef.current
          if (activeRequest && activeRequest.requestId === request.requestId) {
            activeRequestRef.current = {
              ...activeRequest,
              progressMessageId: progressMessageId ?? undefined,
              progressMessageRetryCount,
            }
            persistAgentRequests()
          }
        }).catch((error) => {
          progressMessageRetryCount += 1
          progressMessageId = null
          progressPublishingDisabled = progressMessageRetryCount >= TELEGRAM_MAX_PROGRESS_MESSAGE_RETRIES
          lastProgressMessage = null
          const activeRequest = activeRequestRef.current
          if (activeRequest && activeRequest.requestId === request.requestId) {
            activeRequestRef.current = {
              ...activeRequest,
              progressMessageId: undefined,
              progressMessageRetryCount,
            }
            persistAgentRequests()
          }
          notiaLog(TELEGRAM_AI_DIAGNOSTIC_MODULE, 'telegram progress update failed', {
            error: describeTelegramAgentError(error, 'No se pudo actualizar el progreso.'),
          }, 'error')
        })
      }
      const publishThinkingStarted = (): void => {
        const nextProgressState = markTelegramProgressThinking(progressState)
        if (nextProgressState === progressState) return
        progressState = nextProgressState
        lastProgressPublishedAt = null
        publishProgress({ type: 'phase-changed', phase: progressState.phase, round: progressState.round })
      }
      progressPublisherRef.current = publishProgress
      publishProgress({ type: 'request-received' })
      if (request.plan) {
        progressState = {
          ...progressState,
          phase: 'planning',
          reasoningSummary: 'Estoy retomando el TO-DO previamente registrado.',
          plan: {
            steps: request.plan.steps.map((step) => ({
              id: step.id,
              status: step.status,
              label: 'continuando una tarea autorizada',
            })),
          },
        }
        publishProgress({ type: 'phase-changed', phase: 'planning', round: null })
      }
      try {
        let text = request.text
        let image: AiImageAttachment | null = null
        let financeSourceReference = pendingFinanceSourceReferenceRef.current
        if (request.attachment) {
          phase = request.attachment.kind === 'photo' ? 'downloading-image' : 'extracting-pdf'
          publishProgress({ type: 'phase-changed', phase: 'preparing', round: null })
          if (request.attachment.kind === 'pdf') {
            publishProgress({ type: 'multimodal-stage', stage: 'extracting' })
            const downloaded = await extractTelegramPdf(state.telegram.botToken, request.attachment.value)
            financeSourceReference = buildTelegramFinanceSourceReference(downloaded.fileId, 'pdf')
            pendingFinanceSourceReferenceRef.current = financeSourceReference
            if (!downloaded.extractedContent.trim()) {
              const pages = await renderTelegramPdfPages(downloaded.base64 ?? '')
            image = { name: downloaded.fileName, mimeType: 'image/jpeg', base64: pages[0], additionalBase64: pages.slice(1) }
              text = `${text ? `${text}\n\n` : ''}[Origen: PDF de Telegram fileId=${downloaded.fileId}, renderizado como ${pages.length} imagen(es). Analiza visualmente todas las páginas y clasifica el documento como recibo de sueldo, resumen de tarjeta de crédito, ticket u otro. Extrae todos los campos legibles y usa la herramienta financiera correspondiente.]`
            } else {
            text = `${text ? `${text}\n\n` : ''}[Origen: PDF de Telegram fileId=${downloaded.fileId}. Contenido extraído por el extractor documental: ${downloaded.extractedContent}] Clasifica el documento como recibo de sueldo, resumen de tarjeta de crédito, ticket u otro y usa la herramienta financiera correspondiente. Para un recibo de sueldo usa signedDocument=true solo si el contenido indica firma digital, electrónica o manuscrita; en ese caso conserva el neto impreso aunque difiera de bruto menos descuentos.`
            }
            publishProgress({ type: 'phase-changed', phase: 'reading', round: null })
          } else {
          publishProgress({ type: 'multimodal-stage', stage: 'analyzing-image' })
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
        publishProgress({ type: 'multimodal-stage', stage: 'building-context' })
        publishProgress({ type: 'phase-changed', phase: 'preparing', round: null })
        const agentBuildStartedAt = performance.now()
        notiaLog(TELEGRAM_AI_DIAGNOSTIC_MODULE, 'agent context build started', undefined, 'info')
        const files = await loadLibraryFileOptions(state.library)
        const agent = await createChatScopedAgent({
          scope: 'library',
          enableFinanceTools: true,
          validateFinanceResponses: request.scope === 'finance',
          library: state.library,
          scopePaths: files.map((file) => file.path),
          actorUserId: request.actorUserId,
          aiPreferences: state.aiPreferences,
          promptFileName: loadSelectedAgentPromptFileName(state.library.id),
          responseFormat: 'telegram-html',
          financeSourceReference,
          onFinancePurchaseSaved: (sourceReference) => {
            if (pendingFinanceSourceReferenceRef.current === sourceReference) pendingFinanceSourceReferenceRef.current = null
          },
          onFinanceSalarySaved: (sourceReference, salary) => {
            if (pendingFinanceSourceReferenceRef.current === sourceReference) pendingFinanceSourceReferenceRef.current = null
            if (salary) savedSalary = salary
          },
          onFinanceCreditCardStatementSaved: (sourceReference) => {
            if (pendingFinanceSourceReferenceRef.current === sourceReference) pendingFinanceSourceReferenceRef.current = null
          },
          requestClarification: (question, signal, choices = []) => waitForText(question, choices, signal),
          requestConfirmation: confirm,
          requestExecutionPlanApproval: async (steps, signal) => ({
            approved: await confirm(
              `Aprobar este plan de ejecución:\n${steps.map((step, index) => `${index + 1}. ${step.label}`).join('\n')}`,
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
          requestId: request.requestId,
          agent,
          prompt: text,
          image,
          previousMessages: historyRef.current,
          intentContext: {},
          toolCallTimeoutMs: TELEGRAM_AI_TOOL_CALL_TIMEOUT_MS,
          streamFinalResponse: false,
          maxRounds: request.attachment ? TELEGRAM_IMAGE_AI_MAX_ROUNDS : undefined,
          diagnosticModule: request.attachment ? TELEGRAM_AI_DIAGNOSTIC_MODULE : undefined,
        }, {
          abortSignal: abortController.signal,
          onThinkingDelta: () => {
            publishThinkingStarted()
          },
          onAgentProgress: publishProgress,
        })
        if (savedSalary) {
          phase = 'verifying-salary-persistence'
          publishProgress({ type: 'verification-started', operationId: null })
          await verifyFinanceSalaryPersistence(state.library, savedSalary)
        } else if (isUnverifiedTelegramSalarySuccess(answer, savedSalary)) {
          throw new Error('Telegram recibió una respuesta de éxito salarial sin una persistencia verificable.')
        }
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
        publishProgress({ type: 'phase-changed', phase: 'responding', round: null })
        await progressUpdateQueue
        await sendTelegramMessage(token, authorizedChatId, answer, [], 'HTML')
        publishProgress({ type: 'completed', rounds: 0 })
        await progressUpdateQueue
        notiaLog(TELEGRAM_AI_DIAGNOSTIC_MODULE, 'telegram answer sent', {
          durationMs: Math.round(performance.now() - requestStartedAt),
        }, 'info')
        state.onLibraryChanged()
      } catch (error) {
        if (abortController.signal.aborted) {
          notiaLog(TELEGRAM_AI_DIAGNOSTIC_MODULE, 'telegram request interrupted during cleanup', {
            requestId: request.requestId,
          }, 'info')
          return
        }
        const message = describeTelegramAgentError(error)
        publishProgress({ type: 'failed', code: 'internal' })
        await progressUpdateQueue
        notiaLog(TELEGRAM_AI_DIAGNOSTIC_MODULE, 'agent request failed', {
          phase,
          scope: request.scope,
          hasPhoto: Boolean(request.attachment),
          durationMs: Math.round(performance.now() - requestStartedAt),
          error: message,
        }, 'error')
        try {
          await sendTelegramMessage(token, authorizedChatId, message)
        } catch (sendError) {
          notiaLog(TELEGRAM_AI_DIAGNOSTIC_MODULE, 'telegram error message failed', {
            error: describeTelegramAgentError(sendError, 'No se pudo enviar el error a Telegram.'),
          }, 'error')
        }
      } finally {
        if (progressPublisherRef.current === publishProgress) progressPublisherRef.current = null
        if (activeAbortController === abortController) activeAbortController = null
        busyRef.current = false
      }
    }

    const drainAgentRequests = async () => {
      if (drainingRequestsRef.current) return
      drainingRequestsRef.current = true
      try {
        while (!cancelled) {
          const request = pendingRequestsRef.current.shift()
          if (!request) return
          activeRequestRef.current = withTelegramRequestStatus(request, 'active')
          persistAgentRequests()
          try {
            await runAgent(activeRequestRef.current)
          } catch (error) {
            notiaLog(TELEGRAM_AI_DIAGNOSTIC_MODULE, 'telegram queue request failed unexpectedly', {
              error: describeTelegramAgentError(error),
            }, 'error')
          } finally {
            activeRequestRef.current = null
            persistAgentRequests()
          }
        }
      } finally {
        drainingRequestsRef.current = false
      }
    }

    const enqueueAgentRequest = (request: TelegramAgentRequest): number | null => {
      const queuedAhead = enqueueTelegramAgentRequest(
        pendingRequestsRef.current,
        withTelegramRequestStatus({ requestId: createTelegramAgentRequestId(), ...request }, 'queued'),
      )
      if (queuedAhead === null) return null
      persistAgentRequests()
      const requestsAhead = queuedAhead + (busyRef.current ? 1 : 0)
      void drainAgentRequests()
      return requestsAhead
    }

    const handleTelegramLinking = async (update: TelegramUpdate): Promise<number | null> => {
      const state = currentRef.current
      if (!state.library) return null
      if (update.chatType && update.chatType !== 'private') {
        await sendTelegramMessage(state.telegram.botToken, update.chatId, 'El enlace de Telegram solo está disponible en chats privados.')
        return null
      }
      const context = libraryDatabaseContext()
      let linkedUser
      try {
        linkedUser = await resolveLibraryTelegramUser(context, update.user.id, update.chatId)
      } catch {
        await sendTelegramMessage(state.telegram.botToken, update.chatId, 'No se pudo verificar el enlace. Intentá nuevamente en unos segundos.')
        return null
      }
      if (linkedUser) {
        authorizedChatId = update.chatId
        return update.user.id
      }

      const now = Date.now()
      const command = update.text?.trim().toLocaleLowerCase('es')
      const currentFlow = linkFlows.get(update.chatId)
      if (currentFlow?.blockedUntil && currentFlow.blockedUntil > now && command !== '/start' && command !== '/cancelar' && command !== '/cancel') {
        await sendTelegramMessage(state.telegram.botToken, update.chatId, 'Demasiados intentos. Esperá unos segundos antes de volver a intentar o escribí /start para reiniciar el enlace.')
        return null
      }
      if (command === '/start') {
        linkFlows.set(update.chatId, { step: 'username', expiresAt: now + TELEGRAM_CONFIRMATION_TIMEOUT_MS, attempts: 0 })
        await sendTelegramMessage(state.telegram.botToken, update.chatId, 'Para vincular Telegram, escribí tu nombre de usuario de Notia. Escribí /cancelar para detener el enlace.')
        return null
      }
      if (command === '/cancelar' || command === '/cancel') {
        linkFlows.delete(update.chatId)
        await sendTelegramMessage(state.telegram.botToken, update.chatId, 'Enlace cancelado. Escribí /start cuando quieras intentarlo nuevamente.')
        return null
      }
      let flow = linkFlows.get(update.chatId)
      if (!flow || flow.expiresAt <= now) {
        linkFlows.delete(update.chatId)
        await sendTelegramMessage(state.telegram.botToken, update.chatId, 'No tenés un usuario de Notia vinculado. Escribí /start para iniciar sesión y vincular este chat.')
        return null
      }
      const text = update.text?.trim() ?? ''
      if (!text || update.audio || update.photo || update.document || update.callbackQueryId) {
        await sendTelegramMessage(state.telegram.botToken, update.chatId, 'Durante el enlace solo se aceptan respuestas de texto. Escribí /cancelar para detenerlo.')
        return null
      }
      if (flow.step === 'username') {
        try {
          const user = await findLibraryUser(context, text)
          if (!user) {
            flow = { ...flow, attempts: flow.attempts + 1 }
            if (flow.attempts >= TELEGRAM_LINK_MAX_ATTEMPTS) {
              flow = { ...flow, blockedUntil: now + TELEGRAM_LINK_COOLDOWN_MS }
            }
            linkFlows.set(update.chatId, flow)
            await sendTelegramMessage(state.telegram.botToken, update.chatId, 'No se pudo completar el enlace con esos datos. Revisá el nombre e intentá nuevamente.')
            return null
          }
          flow = { ...flow, userId: user.id, step: user.passwordConfigured ? 'existing-password' : 'new-password' }
          linkFlows.set(update.chatId, flow)
          await sendTelegramMessage(state.telegram.botToken, update.chatId, user.passwordConfigured ? 'Escribí la contraseña de tu usuario de Notia.' : 'Este usuario todavía no tiene contraseña. Escribí una nueva de 8 a 256 caracteres.')
        } catch {
          await sendTelegramMessage(state.telegram.botToken, update.chatId, 'No se pudo completar el enlace. Intentá nuevamente.')
        }
        return null
      }
      if (flow.step === 'new-password') {
        if (text.length < 8 || text.length > 256) {
          await sendTelegramMessage(state.telegram.botToken, update.chatId, 'La contraseña debe tener entre 8 y 256 caracteres. Intentá nuevamente.')
          return null
        }
        linkFlows.set(update.chatId, { ...flow, step: 'confirm-password', password: text })
        await sendTelegramMessage(state.telegram.botToken, update.chatId, 'Repetí la nueva contraseña para confirmarla.')
        return null
      }
      if (flow.step === 'confirm-password') {
        if (text !== flow.password) {
          flow = { ...flow, password: undefined, step: 'new-password', attempts: flow.attempts + 1 }
          if (flow.attempts >= TELEGRAM_LINK_MAX_ATTEMPTS) {
            flow = { ...flow, blockedUntil: now + TELEGRAM_LINK_COOLDOWN_MS }
          }
          linkFlows.set(update.chatId, flow)
          await sendTelegramMessage(state.telegram.botToken, update.chatId, 'Las contraseñas no coinciden. Escribí una nueva contraseña para intentarlo otra vez.')
          return null
        }
      }
      if (flow.step === 'existing-password' || flow.step === 'confirm-password') {
        try {
          await linkLibraryUserTelegram(context, flow.userId!, update.user.id, update.chatId, text)
          linkFlows.delete(update.chatId)
          authorizedChatId = update.chatId
          await sendTelegramMessage(state.telegram.botToken, update.chatId, 'Telegram quedó vinculado. Ya podés enviar consultas.')
          return update.user.id
        } catch {
          flow = { ...flow, attempts: flow.attempts + 1 }
          if (flow.attempts >= TELEGRAM_LINK_MAX_ATTEMPTS) {
            flow = { ...flow, blockedUntil: now + TELEGRAM_LINK_COOLDOWN_MS }
            linkFlows.set(update.chatId, flow)
            await sendTelegramMessage(state.telegram.botToken, update.chatId, 'Se alcanzó el límite de intentos. Escribí /start más tarde para reintentar.')
          } else {
            linkFlows.set(update.chatId, flow)
            await sendTelegramMessage(state.telegram.botToken, update.chatId, 'No se pudo verificar la contraseña. Intentá nuevamente o escribí /cancelar.')
          }
        }
      }
      return null
    }

    const handleUpdate = async (update: TelegramUpdate) => {
      const state = currentRef.current
      if (!state.library) return
      // Existing sessions can finish their current request while the library
      // is migrated. New sessions always go through SQLite linking; this
      // narrow compatibility branch is only active when the legacy peer is
      // explicitly present in the current configuration.
      const legacyPeer = import.meta.env.MODE === 'test' ? state.telegram.authorizedPeer : null
      const linkedTelegramUserId = legacyPeer && legacyPeer.chatId === update.chatId && legacyPeer.userId === update.user.id
        ? update.user.id
        : await handleTelegramLinking(update)
      if (linkedTelegramUserId === null) return
      const peer = { chatId: update.chatId, userId: linkedTelegramUserId }
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
          await sendTelegramMessage(state.telegram.botToken, peer.chatId, decision === 'yes' ? 'Confirmación recibida. Aplicando el cambio…' : 'Operación cancelada.')
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
          progressPublisherRef.current?.({ type: 'multimodal-stage', stage: 'transcribing' })
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
      if (!update.photo && !update.document && plainText.toLocaleLowerCase('es') === TELEGRAM_RECOVERY_COMMAND) {
        if (interruptedRequestsRef.current.length === 0) {
          await sendTelegramMessage(state.telegram.botToken, peer.chatId, 'No hay solicitudes interrumpidas para reanudar.')
          return
        }
        const recoveredRequests = interruptedRequestsRef.current.splice(0)
          .map((request) => withTelegramRequestStatus(request, 'queued'))
        const recoverableRequests = recoveredRequests.filter((request) => request.text.trim() || request.attachment)
        const requestsRequiringResend = recoveredRequests.length - recoverableRequests.length
        pendingRequestsRef.current.push(...recoverableRequests)
        persistAgentRequests()
        const recoveryMessage = recoverableRequests.length > 0
          ? `${recoverableRequests.length === 1 ? 'Solicitud' : 'Solicitudes'} marcada${recoverableRequests.length === 1 ? '' : 's'} para reanudar. La ejecución requiere este comando explícito.`
          : 'No hay solicitudes con contenido recuperable.'
        const resendMessage = requestsRequiringResend > 0
          ? ` ${requestsRequiringResend === 1 ? 'Una solicitud de texto' : `${requestsRequiringResend} solicitudes de texto`} requiere que la reenvíes: no guardo el texto original para proteger tu privacidad.`
          : ''
        await sendTelegramMessage(state.telegram.botToken, peer.chatId, `${recoveryMessage}${resendMessage}`)
        void drainAgentRequests()
        return
      }
      if (!update.photo && !update.document && confirmationRef.current.size === 1) {
        const decision = parseTelegramConfirmationDecision(plainText)
        if (decision !== null) {
          const resolveConfirmation = confirmationRef.current.values().next().value
          resolveConfirmation?.(decision)
          await sendTelegramMessage(state.telegram.botToken, peer.chatId, decision ? 'Confirmación recibida. Aplicando el cambio…' : 'Operación cancelada.')
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
      const scope = attachment || isTelegramFinanceRequest(prompt)
        ? 'finance'
        : resolveTelegramAgentScope(prompt, conversationScopeRef.current)
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
        await sendTelegramMessage(state.telegram.botToken, peer.chatId, 'No puedo aceptar más de 10 solicitudes pendientes. Esperá a que termine alguna e intentá nuevamente.')
        return
      }
      if (!update.audio && requestsAhead > 0) {
        await sendTelegramMessage(
          state.telegram.botToken,
          peer.chatId,
          attachment
            ? `Documento recibido. Quedó en cola después de ${requestsAhead} solicitud${requestsAhead === 1 ? '' : 'es'}.`
            : `Solicitud recibida. Quedó en cola después de ${requestsAhead} solicitud${requestsAhead === 1 ? '' : 'es'}.`,
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
    void drainAgentRequests()
    void loop()
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', cancelOnVisibilityChange)
      interruptActiveRequest()
      persistAgentRequests()
    }
  }, [authorizedChatIdValue, authorizedUserId, libraryId, telegramEnabled, telegramToken])
}
