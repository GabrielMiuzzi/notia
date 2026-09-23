import { addPluginListener, invoke, type PluginListener } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { ChatFileContextMode, ChatInlineFileAttachment } from '../chat/chatAttachmentRuntime'
import type { StoredChatMessage } from '../chat/chatDocumentStorage'
import type { AiPreferences } from '../preferences/aiSettingsStorage'
import { resolveAiPreferencesForTransport as normalizeAiSettingsInput } from '../preferences/aiSettingsStorage'
import { getRuntimeDevice } from '../../utils/platform/getRuntimeDevice'
import type { AgentProgressEvent } from '../../types/ai/agentContracts'

const AI_HEALTH_CACHE_TTL_MS = 10_000
const AI_CONTEXT_BUDGET = {
  maxMemoryItems: 50,
  maxContextChars: 30_000,
  maxIndexContextFiles: 50,
  maxIndexContextChars: 6_000,
} as const
const MAX_MEMORY_ITEMS = AI_CONTEXT_BUDGET.maxMemoryItems
const MAX_CONTEXT_CHARS = AI_CONTEXT_BUDGET.maxContextChars
const MAX_INDEX_CONTEXT_FILES = AI_CONTEXT_BUDGET.maxIndexContextFiles
const MAX_INDEX_CONTEXT_CHARS = AI_CONTEXT_BUDGET.maxIndexContextChars
const PUBLISHED_STREAM_MAX_RECONNECTS = 1
interface AiHealthCacheEntry {
  result: AiHealthCheckResult
  timestamp: number
}

let aiHealthCache: AiHealthCacheEntry | null = null
let aiHealthCacheKey = ''
const DESKTOP_AI_HEALTH_COMMANDS = ['check_desktop_ai_health'] as const
const DESKTOP_AI_CHAT_COMMANDS = ['run_desktop_ai_chat'] as const
const DESKTOP_AI_CHAT_STREAMING_COMMAND = 'run_desktop_ai_chat_streaming'
const DESKTOP_AI_MODEL_LIST_COMMANDS = ['list_desktop_ai_models'] as const
const DESKTOP_AI_MODEL_DETAILS_COMMANDS = ['inspect_desktop_ai_model'] as const
const ANDROID_AI_HEALTH_COMMANDS = [
  'check_android_ai_health',
  'mobile_ai_bridge::check_android_ai_health',
] as const
const ANDROID_AI_CHAT_COMMANDS = [
  'run_android_ai_chat',
  'mobile_ai_bridge::run_android_ai_chat',
] as const
const ANDROID_AI_CHAT_STREAMING_COMMANDS = [
  'run_android_ai_chat_streaming',
  'mobile_ai_bridge::run_android_ai_chat_streaming',
] as const
const ANDROID_AI_CHAT_STREAMING_CANCEL_COMMAND = 'cancel_android_ai_chat_streaming'
const ANDROID_AI_MODEL_LIST_COMMANDS = [
  'list_android_ai_models',
  'mobile_ai_bridge::list_android_ai_models',
] as const
const ANDROID_AI_MODEL_DETAILS_COMMANDS = [
  'inspect_android_ai_model',
  'mobile_ai_bridge::inspect_android_ai_model',
] as const

export interface AiHealthCheckResult {
  ok: boolean
  message: string
  defaultModel?: string
}

export interface AiModelOption {
  name: string
  supportsThinking: boolean
  supportsThinkingLevels: boolean
  supportsVision: boolean
  supportsTools: boolean
}

export interface AiImageAttachment {
  name: string
  mimeType: string
  base64: string
  additionalBase64?: string[]
}

function imageAttachmentBase64(image: AiImageAttachment | null | undefined): string[] {
  if (!image) return []
  return [image.base64, ...(image.additionalBase64 ?? [])]
    .map((value) => value.trim())
    .filter(Boolean)
}

interface AiMessagePayload {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  images?: string[]
}

interface StreamAiChatReplyInput {
  prompt: string
  previousMessages: StoredChatMessage[]
  longTermMemories: string[]
  files?: ChatInlineFileAttachment[]
  image?: AiImageAttachment | null
  selectedContextMode: ChatFileContextMode
}

interface StreamAiChatReplyOptions {
  onMessageDelta?: (delta: string) => void
  onThinkingDelta?: (delta: string) => void
  onAgentRoundStart?: (round: number) => void
  onAgentProgress?: (event: AgentProgressEvent) => void
  thinking?: boolean | 'low' | 'medium' | 'high'
  abortSignal?: AbortSignal
}

interface BridgeAiHealthResponse {
  ok?: unknown
  message?: unknown
  defaultModel?: unknown
}

interface BridgeAiChatResponse {
  answer?: unknown
  error?: unknown
}

interface BridgeAiModelListResponse {
  models?: unknown
}

interface BridgeAiModelDetailsResponse {
  capabilities?: unknown
}

interface AiChatStreamEvent {
  requestId: string
  type: 'thinking' | 'delta' | 'done' | 'error'
  payload?: {
    delta?: string
    answer?: string
    message?: string
  }
}

function describeAiError(error: unknown, fallback: string): Error {
  if (error instanceof Error && error.message.trim()) {
    return new Error(error.message.trim())
  }

  if (typeof error === 'string' && error.trim()) {
    return new Error(error.trim())
  }

  if (typeof error === 'object' && error !== null && 'message' in error
    && typeof (error as { message?: unknown }).message === 'string'
    && (error as { message: string }).message.trim()) {
    return new Error((error as { message: string }).message.trim())
  }

  return new Error(fallback)
}

function isLikelyMultimodalModelName(model: string): boolean {
  const normalized = model.trim().toLowerCase()
  if (!normalized) {
    return false
  }

  return [
    'vision',
    'vl',
    'llava',
    'bakllava',
    'moondream',
    'minicpm-v',
    'gemma3',
    'gemma4',
    'gemini',
    'glm-ocr',
    'qwen3.5',
  ].some((token) => normalized.includes(token))
}

async function streamDesktopAiChatViaBridge(
  preferences: AiPreferences,
  model: string,
  messages: AiMessagePayload[],
  options: StreamAiChatReplyOptions,
): Promise<string> {
  if (window.__NOTIA_PUBLISHED_TASK_MANAGER__) {
    return streamPublishedTaskManagerAiChat(preferences, model, messages, options)
  }
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
  let answer = ''
  let settled = false
  let unlisten: UnlistenFn | null = null

  return new Promise((resolve, reject) => {
    const settle = (result: string | Error) => {
      if (settled) {
        return
      }
      settled = true
      options.abortSignal?.removeEventListener('abort', onAbort)
      unlisten?.()
      if (result instanceof Error) {
        reject(result)
      } else {
        resolve(result)
      }
    }
    const onAbort = () => settle(new Error('Se cancelo la respuesta de la IA.'))
    options.abortSignal?.addEventListener('abort', onAbort, { once: true })

    void listen<AiChatStreamEvent>('notia-ai-chat-stream', (event) => {
      if (event.payload.requestId !== requestId || settled) {
        return
      }
      const { type, payload } = event.payload
      if (type === 'delta' && typeof payload?.delta === 'string') {
        answer += payload.delta
        options.onMessageDelta?.(payload.delta)
      } else if (type === 'done') {
        const finalAnswer = typeof payload?.answer === 'string' ? payload.answer.trim() : answer.trim()
        settle(finalAnswer || new Error('La IA no devolvio contenido.'))
      } else if (type === 'error') {
        settle(new Error(payload?.message?.trim() || 'Se interrumpio el stream de IA.'))
      }
    }).then((stopListening) => {
      if (settled) {
        stopListening()
        return
      }
      unlisten = stopListening
      return invoke(DESKTOP_AI_CHAT_STREAMING_COMMAND, {
        payload: {
          requestId,
          ...normalizeAiSettingsInput(preferences),
          model,
          think: options.thinking ?? false,
          messages,
        },
      }).catch((error) => settle(describeAiError(error, 'No se pudo iniciar el streaming nativo.')))
    }).catch((error) => settle(describeAiError(error, 'No se pudo escuchar el streaming nativo.')))
  })
}

function isLikelyThinkingModelName(model: string): boolean {
  const normalized = model.trim().toLowerCase()
  return ['deepseek-r1', 'gpt-oss', 'qwen3', 'qwq', 'reasoning'].some((token) => normalized.includes(token))
}

function supportsThinkingLevels(model: string): boolean {
  return model.trim().toLowerCase().includes('gpt-oss')
}

async function streamPublishedTaskManagerAiChat(
  preferences: AiPreferences,
  model: string,
  messages: AiMessagePayload[],
  options: StreamAiChatReplyOptions,
): Promise<string> {
  const publicationPath = window.location.pathname.replace(/\/app\/?$/, '').replace(/\/+$/, '')
  const requestBody = JSON.stringify({
    ...normalizeAiSettingsInput(preferences),
    model,
    think: options.thinking ?? false,
    messages,
  })

  let lastError: unknown = null
  for (let reconnect = 0; reconnect <= PUBLISHED_STREAM_MAX_RECONNECTS; reconnect += 1) {
    let receivedEvent = false
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null
    let removeAbortListener: (() => void) | null = null
    try {
      if (options.abortSignal?.aborted) {
        throw new Error('Se cancelo la respuesta de la IA.')
      }
      const response = await fetch(`${publicationPath}/ai/stream`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', accept: 'application/x-ndjson' },
        body: requestBody,
        signal: options.abortSignal,
      })
      if (options.abortSignal?.aborted) {
        throw new Error('Se cancelo la respuesta de la IA.')
      }
      if (!response.ok || !response.body) {
        const detail = await response.text()
        throw new Error(detail || 'No se pudo iniciar el streaming publicado.')
      }

      reader = response.body.getReader()
      const decoder = new TextDecoder()
      let pending = ''
      let answer = ''
      const abortRead = options.abortSignal
        ? new Promise<never>((_, reject) => {
            const onAbort = () => reject(new Error('Se cancelo la respuesta de la IA.'))
            options.abortSignal?.addEventListener('abort', onAbort, { once: true })
            removeAbortListener = () => options.abortSignal?.removeEventListener('abort', onAbort)
          })
        : null
      const processLine = (line: string) => {
        if (!line.trim()) return
        receivedEvent = true
        const event = JSON.parse(line) as { type?: unknown; delta?: unknown; answer?: unknown; message?: unknown }
        if (event.type === 'thinking' && typeof event.delta === 'string') {
          options.onThinkingDelta?.(event.delta)
        } else if (event.type === 'delta' && typeof event.delta === 'string') {
          answer += event.delta
          options.onMessageDelta?.(event.delta)
        } else if (event.type === 'done' && typeof event.answer === 'string') {
          answer = event.answer
        } else if (event.type === 'error') {
          throw new Error(typeof event.message === 'string' ? event.message : 'Se interrumpio el stream de IA.')
        }
      }

      while (true) {
        const readResult = abortRead
          ? await Promise.race([reader.read(), abortRead])
          : await reader.read()
        const { done, value } = readResult
        pending += decoder.decode(value, { stream: !done })
        const lines = pending.split('\n')
        pending = lines.pop() ?? ''
        lines.forEach(processLine)
        if (done) break
      }
      processLine(pending)
      const normalizedAnswer = answer.trim()
      if (!normalizedAnswer) throw new Error('La IA no devolvio contenido.')
      return normalizedAnswer
    } catch (error) {
      lastError = error
      if (options.abortSignal?.aborted || receivedEvent || reconnect >= PUBLISHED_STREAM_MAX_RECONNECTS) {
        throw error
      }
    } finally {
      const abortCleanup = removeAbortListener as (() => void) | null
      if (abortCleanup) {
        abortCleanup()
      }
      if (reader) {
        await reader.cancel().catch(() => undefined)
        reader.releaseLock()
      }
    }
  }

  throw describeAiError(lastError, 'No se pudo iniciar el streaming publicado.')
}

function isLikelyNativeToolModelName(model: string): boolean {
  const normalized = model.trim().toLowerCase()
  return [
    'qwen3.5',
    'qwen3.6',
    'gemma4',
    'granite4',
    'devstral',
    'hermes3',
    'llama3-groq-tool-use',
    'lfm2',
    'nemotron3',
  ].some((token) => normalized.includes(token))
}

async function invokeDesktopAiModelList(preferences: AiPreferences): Promise<string[]> {
  let lastError: unknown = null

  for (const command of DESKTOP_AI_MODEL_LIST_COMMANDS) {
    try {
      const response = await invoke<BridgeAiModelListResponse>(command, {
        payload: normalizeAiSettingsInput(preferences),
      })

      return Array.isArray(response.models)
        ? response.models
          .filter((model): model is string => typeof model === 'string')
          .map((model) => model.trim())
          .filter(Boolean)
        : []
    } catch (error) {
      lastError = error
    }
  }

  throw describeAiError(lastError, 'No se pudo listar los modelos de IA.')
}

async function invokeDesktopAiModelDetails(
  preferences: AiPreferences,
  model: string,
): Promise<string[]> {
  let lastError: unknown = null

  for (const command of DESKTOP_AI_MODEL_DETAILS_COMMANDS) {
    try {
      const response = await invoke<BridgeAiModelDetailsResponse>(command, {
        payload: { ...normalizeAiSettingsInput(preferences), model },
      })
      return Array.isArray(response.capabilities)
        ? response.capabilities.filter((capability): capability is string => typeof capability === 'string')
        : []
    } catch (error) {
      lastError = error
    }
  }

  throw describeAiError(lastError, 'No se pudieron consultar las capacidades del modelo de IA.')
}

async function invokeAndroidAiModelDetails(
  preferences: AiPreferences,
  model: string,
): Promise<string[]> {
  let lastError: unknown = null
  for (const command of ANDROID_AI_MODEL_DETAILS_COMMANDS) {
    try {
      const response = await invoke<BridgeAiModelDetailsResponse>(command, {
        payload: { ...normalizeAiSettingsInput(preferences), model },
      })
      return Array.isArray(response.capabilities)
        ? response.capabilities.filter((capability): capability is string => typeof capability === 'string')
        : []
    } catch (error) {
      lastError = error
    }
  }
  throw describeAiError(lastError, 'No se pudieron consultar las capacidades del modelo de IA.')
}

export async function checkModelSupportsVision(preferences: AiPreferences, model: string): Promise<boolean> {
  const capabilities = getRuntimeDevice() === 'Android'
    ? await invokeAndroidAiModelDetails(preferences, model)
    : await invokeDesktopAiModelDetails(preferences, model)
  return capabilities.includes('vision')
}

async function loadAiModelOption(preferences: AiPreferences, name: string): Promise<AiModelOption> {
  const fallback: AiModelOption = {
    name,
    supportsThinking: isLikelyThinkingModelName(name),
    supportsThinkingLevels: supportsThinkingLevels(name),
    supportsVision: isLikelyMultimodalModelName(name),
    supportsTools: isLikelyNativeToolModelName(name),
  }

  try {
    const isAndroid = getRuntimeDevice() === 'Android'
    const capabilities = isAndroid
      ? await invokeAndroidAiModelDetails(preferences, name)
      : await invokeDesktopAiModelDetails(preferences, name)
    return {
      name,
      supportsThinking: isAndroid ? capabilities.includes('thinking') : capabilities.includes('thinking') || fallback.supportsThinking,
      supportsThinkingLevels: isAndroid ? false : fallback.supportsThinkingLevels,
      supportsVision: isAndroid ? capabilities.includes('vision') : capabilities.includes('vision') || fallback.supportsVision,
      supportsTools: isAndroid ? capabilities.includes('tools') : capabilities.includes('tools') || fallback.supportsTools,
    }
  } catch {
    if (getRuntimeDevice() === 'Android') {
      return {
        name,
        supportsThinking: false,
        supportsThinkingLevels: false,
        supportsVision: false,
        supportsTools: false,
      }
    }
    return fallback
  }
}

async function mapWithConcurrency<TInput, TOutput>(
  values: TInput[],
  concurrency: number,
  mapper: (value: TInput) => Promise<TOutput>,
): Promise<TOutput[]> {
  const results = new Array<TOutput>(values.length)
  let nextIndex = 0
  const worker = async () => {
    while (nextIndex < values.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await mapper(values[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker))
  return results
}

export async function isAiModelMultimodal(preferences: AiPreferences, model: string): Promise<boolean> {
  const normalizedPreferences = normalizeAiSettingsInput(preferences)
  if (isLikelyMultimodalModelName(model)) {
    return true
  }

  return checkModelSupportsVision(normalizedPreferences, model).catch(() => false)
}

const modelListCache = new Map<string, { models: AiModelOption[]; timestamp: number }>()
const MODEL_LIST_CACHE_TTL_MS = 30_000

function buildModelListCacheKey(preferences: AiPreferences): string {
  const normalized = normalizeAiSettingsInput(preferences)
  return `${normalized.ollamaUrl}::${normalized.apiKey ? 'configured' : 'missing'}`
}

function readCachedModelList(preferences: AiPreferences): AiModelOption[] | null {
  const key = buildModelListCacheKey(preferences)
  const entry = modelListCache.get(key)
  if (!entry) {
    return null
  }

  if (Date.now() - entry.timestamp > MODEL_LIST_CACHE_TTL_MS) {
    modelListCache.delete(key)
    return null
  }

  return entry.models
}

function writeCachedModelList(preferences: AiPreferences, models: AiModelOption[]): void {
  const key = buildModelListCacheKey(preferences)
  modelListCache.set(key, { models, timestamp: Date.now() })
}

async function listAiModelsFromBridge(preferences: AiPreferences): Promise<string[]> {
  if (getRuntimeDevice() === 'Android') {
    return invokeAndroidAiModelList(preferences)
  }

  return invokeDesktopAiModelList(preferences)
}

export async function listAiModels(preferences: AiPreferences): Promise<AiModelOption[]> {
  const normalizedPreferences = normalizeAiSettingsInput(preferences)
  const cached = readCachedModelList(normalizedPreferences)
  if (cached) {
    return cached
  }

  const names = await listAiModelsFromBridge(normalizedPreferences)

  const uniqueNames = Array.from(new Set(names)).sort((left, right) => left.localeCompare(right, 'en'))
  const models = window.__NOTIA_PUBLISHED_TASK_MANAGER__
    ? uniqueNames.map((name) => ({
      name,
      supportsThinking: isLikelyThinkingModelName(name),
      supportsThinkingLevels: supportsThinkingLevels(name),
      supportsVision: isLikelyMultimodalModelName(name),
      supportsTools: isLikelyNativeToolModelName(name),
    }))
    : await mapWithConcurrency(uniqueNames, 4, (name) => loadAiModelOption(normalizedPreferences, name))
  writeCachedModelList(normalizedPreferences, models)
  return models
}

export async function listAiMultimodalModels(preferences: AiPreferences): Promise<AiModelOption[]> {
  const normalizedPreferences = normalizeAiSettingsInput(preferences)
  const allModels = await listAiModels(normalizedPreferences)
  const likelyMultimodalModels = allModels
    .filter((model) => isLikelyMultimodalModelName(model.name))
    .map((model) => model.name)

  const modelsToVerify = likelyMultimodalModels.length > 0
    ? likelyMultimodalModels
    : allModels.slice(0, 12).map((model) => model.name)

  const verifiedModels: AiModelOption[] = []

  for (const model of modelsToVerify) {
    const supportsVision = await checkModelSupportsVision(normalizedPreferences, model).catch(() => false)
    if (supportsVision) {
      verifiedModels.push({
        name: model,
        supportsThinking: isLikelyThinkingModelName(model),
        supportsThinkingLevels: supportsThinkingLevels(model),
        supportsVision: true,
        supportsTools: allModels.find((candidate) => candidate.name === model)?.supportsTools ?? false,
      })
    }
  }

  if (verifiedModels.length > 0) {
    return verifiedModels
  }

  // Fallback for Ollama Cloud when capability introspection is incomplete or rate-limited.
  return likelyMultimodalModels.map((model) => ({
    name: model,
    supportsThinking: isLikelyThinkingModelName(model),
    supportsThinkingLevels: supportsThinkingLevels(model),
    supportsVision: true,
    supportsTools: allModels.find((candidate) => candidate.name === model)?.supportsTools ?? false,
  }))
}

function buildLongTermMemorySection(longTermMemories: string[]): string {
  const normalizedMemories = longTermMemories
    .map((memory) => memory.trim())
    .filter(Boolean)
    .slice(0, MAX_MEMORY_ITEMS)

  if (normalizedMemories.length === 0) {
    return ''
  }

  return [
    'Memoria persistente del usuario:',
    ...normalizedMemories.map((memory) => `- ${memory}`),
  ].join('\n')
}

function normalizePromptSearchValue(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

function extractFileNameFromPath(pathValue: string): string {
  const normalizedPath = pathValue.replace(/\\/g, '/')
  const segments = normalizedPath.split('/').filter(Boolean)
  return segments[segments.length - 1] ?? normalizedPath
}

function rankFileAgainstPrompt(file: ChatInlineFileAttachment, normalizedPrompt: string): number {
  if (!normalizedPrompt) {
    return 0
  }

  const normalizedName = normalizePromptSearchValue(file.name)
  const normalizedPath = normalizePromptSearchValue(file.path)
  const normalizedFileName = normalizePromptSearchValue(extractFileNameFromPath(file.path))
  const fileStem = normalizedFileName.replace(/\.[a-z0-9]+$/i, '')
  let score = 0

  if (normalizedName && normalizedPrompt.includes(normalizedName)) {
    score += 120
  }

  if (normalizedFileName && normalizedPrompt.includes(normalizedFileName)) {
    score += 140
  }

  if (fileStem && normalizedPrompt.includes(fileStem)) {
    score += 180
  }

  if (normalizedPath && normalizedPrompt.includes(normalizedPath)) {
    score += 80
  }

  const promptTokens = Array.from(new Set(
    normalizedPrompt
      .split(/[^a-z0-9]+/i)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3),
  ))

  for (const token of promptTokens) {
    if (normalizedName.includes(token)) {
      score += 12
    }
    if (fileStem.includes(token)) {
      score += 16
    }
    if (normalizedPath.includes(token)) {
      score += 4
    }
  }

  return score
}

function prioritizeFilesForPrompt(
  files: ChatInlineFileAttachment[],
  prompt: string,
): ChatInlineFileAttachment[] {
  const normalizedPrompt = normalizePromptSearchValue(prompt.trim())
  if (!normalizedPrompt) {
    return files
  }

  return files
    .map((file, index) => ({
      file,
      index,
      score: rankFileAgainstPrompt(file, normalizedPrompt),
    }))
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score
      }

      return left.index - right.index
    })
    .map((entry) => entry.file)
}

function buildFileContextSection(
  prompt: string,
  files: ChatInlineFileAttachment[],
  selectedContextMode: ChatFileContextMode,
): string {
  if (files.length === 0) {
    return ''
  }

  if (selectedContextMode === 'index') {
    const header = 'Archivos de referencia:'
    const prioritizedFiles = prioritizeFilesForPrompt(files, prompt)
    const cappedFiles = prioritizedFiles.slice(0, MAX_INDEX_CONTEXT_FILES)
    const lines = cappedFiles.map((file) => `- ${file.name} (${file.path})`)
    if (lines.length === 0) {
      return ''
    }

    let fileList = lines.join('\n')
    if (fileList.length > MAX_INDEX_CONTEXT_CHARS) {
      fileList = `${fileList.slice(0, MAX_INDEX_CONTEXT_CHARS)}\n...`
    }

    return [header, fileList, ''].join('\n')
  }

  const header = 'Archivos de contexto:'
  const sections: string[] = [header]
  const prioritizedFiles = prioritizeFilesForPrompt(files, prompt)
  let consumedChars = 0

  for (const file of prioritizedFiles) {
    const normalizedContent = file.content.trim()
    if (!normalizedContent) {
      continue
    }

    const chunk = [
      `Archivo: ${file.name}`,
      `Ruta: ${file.path}`,
      'Contenido:',
      normalizedContent,
      '',
    ].join('\n')

    if (consumedChars + chunk.length > MAX_CONTEXT_CHARS) {
      break
    }

    sections.push(chunk)
    consumedChars += chunk.length
  }

  return sections.length > 1 ? sections.join('\n') : ''
}

function buildSystemMessageContent(longTermMemories: string[]): string {
  const sections = [
    'Sos el asistente de Notia. Responde con claridad, prioriza el contexto provisto y usa markdown solo cuando aporte valor.',
    buildLongTermMemorySection(longTermMemories),
  ].filter(Boolean)

  return sections.join('\n\n')
}

function buildUserMessageContent(
  prompt: string,
  files: ChatInlineFileAttachment[],
  selectedContextMode: ChatFileContextMode,
): string {
  const sections = [
    buildFileContextSection(prompt, files, selectedContextMode),
    `Pedido del usuario:\n${prompt.trim()}`,
  ].filter(Boolean)

  return sections.join('\n\n')
}

function buildConversationMessages(input: StreamAiChatReplyInput): AiMessagePayload[] {
  const systemMessage: AiMessagePayload = {
    role: 'system',
    content: buildSystemMessageContent(input.longTermMemories),
  }

  const historyMessages: AiMessagePayload[] = input.previousMessages
    .map((message) => ({
      role: message.role,
      content: message.content.trim(),
    }))
    .filter((message) => message.content)

  const userMessage: AiMessagePayload = {
    role: 'user',
    content: buildUserMessageContent(
      input.prompt,
      input.files ?? [],
      input.selectedContextMode,
    ),
    images: imageAttachmentBase64(input.image),
  }

  return [systemMessage, ...historyMessages, userMessage]
}

async function invokeDesktopAiHealth(preferences: AiPreferences): Promise<AiHealthCheckResult> {
  let lastError: unknown = null

  for (const command of DESKTOP_AI_HEALTH_COMMANDS) {
    try {
      const response = await invoke<BridgeAiHealthResponse>(command, {
        payload: normalizeAiSettingsInput(preferences),
      })

      const isOk = Boolean(response.ok)
      return {
        ok: isOk,
        message: typeof response.message === 'string' && response.message.trim()
          ? response.message.trim()
          : isOk
            ? 'Conexion correcta con Ollama.'
            : 'No se pudo conectar con la IA.',
        defaultModel: typeof response.defaultModel === 'string' && response.defaultModel.trim()
          ? response.defaultModel.trim()
          : undefined,
      }
    } catch (error) {
      lastError = error
    }
  }

  throw describeAiError(lastError, 'El backend desktop de IA no esta disponible.')
}

async function invokeAndroidAiHealth(preferences: AiPreferences): Promise<AiHealthCheckResult> {
  let lastError: unknown = null

  for (const command of ANDROID_AI_HEALTH_COMMANDS) {
    try {
      const response = await invoke<BridgeAiHealthResponse>(command, {
        payload: normalizeAiSettingsInput(preferences),
      })

      const isOk = Boolean(response.ok)
      return {
        ok: isOk,
        message: typeof response.message === 'string' && response.message.trim()
          ? response.message.trim()
          : isOk
            ? 'Conexion correcta con Ollama.'
            : 'No se pudo conectar con la IA.',
        defaultModel: typeof response.defaultModel === 'string' && response.defaultModel.trim()
          ? response.defaultModel.trim()
          : undefined,
      }
    } catch (error) {
      lastError = error
    }
  }

  throw describeAiError(lastError, 'El backend Android de IA no esta disponible.')
}

async function resolveDefaultModel(preferences: AiPreferences): Promise<string> {
  const normalizedPreferences = normalizeAiSettingsInput(preferences)
  // A deliberate user selection is already a complete model contract. Avoid
  // an extra discovery round for every chat; the native request will report a
  // precise provider error if that model was removed meanwhile.
  if (normalizedPreferences.selectedModel.trim()) {
    return normalizedPreferences.selectedModel.trim()
  }
  const allModels = await listAiModels(normalizedPreferences)
  if (allModels.length === 0) {
    throw new Error('No hay modelos disponibles en Ollama.')
  }

  const selectedModel = normalizedPreferences.selectedModel
  if (selectedModel && allModels.some((model) => model.name === selectedModel)) {
    return selectedModel
  }

  return allModels[0].name
}

export async function resolveActiveModel(preferences: AiPreferences): Promise<string> {
  return resolveDefaultModel(preferences)
}

async function invokeAndroidAiChat(
  preferences: AiPreferences,
  model: string,
  input: StreamAiChatReplyInput,
  options: StreamAiChatReplyOptions,
): Promise<string> {
  let lastError: unknown = null

  for (const command of ANDROID_AI_CHAT_COMMANDS) {
    try {
      const response = await invoke<BridgeAiChatResponse>(command, {
        payload: {
          ...normalizeAiSettingsInput(preferences),
          model,
          think: options.thinking ?? false,
          prompt: input.prompt,
          previousMessages: input.previousMessages,
          longTermMemories: input.longTermMemories,
          files: input.files ?? [],
          image: input.image ?? null,
          selectedContextMode: input.selectedContextMode,
        },
      })

      if (typeof response.error === 'string' && response.error.trim()) {
        throw new Error(response.error.trim())
      }

      const answer = typeof response.answer === 'string' ? response.answer.trim() : ''
      if (!answer) {
        throw new Error('La IA no devolvio contenido.')
      }

      options.onMessageDelta?.(answer)
      return answer
    } catch (error) {
      lastError = error
    }
  }

  throw describeAiError(lastError, 'No se pudo completar la consulta en Android.')
}

async function invokeAndroidAiChatStreaming(
  preferences: AiPreferences,
  model: string,
  input: StreamAiChatReplyInput,
  options: StreamAiChatReplyOptions,
): Promise<string> {
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
  let lastError: unknown = null
  const listeners: UnlistenFn[] = []
  const pluginListeners: PluginListener[] = []

  return new Promise((resolve, reject) => {
    let answer = ''
    let settled = false

    const cleanup = () => {
      settled = true
      options.abortSignal?.removeEventListener('abort', onAbort)
      listeners.forEach((unlisten) => unlisten())
      pluginListeners.forEach((listener) => { void listener.unregister() })
    }

    const handleSettle = (value: string | Error) => {
      if (settled) {
        return
      }

      cleanup()
      if (value instanceof Error) {
        reject(value)
        return
      }

      resolve(value)
    }

    const onAbort = () => {
      void invoke(ANDROID_AI_CHAT_STREAMING_CANCEL_COMMAND, { payload: { requestId } }).catch(() => {
        // Cancellation is best-effort; the local controller still prevents stale UI updates.
      })
      handleSettle(new Error('Se cancelo la respuesta de la IA.'))
    }
    options.abortSignal?.addEventListener('abort', onAbort, { once: true })

    const handleStreamEvent = (event: AiChatStreamEvent) => {
      if (event.requestId !== requestId) {
        return
      }

      const { type, payload } = event
      if (type === 'thinking' && typeof payload?.delta === 'string') {
        options.onThinkingDelta?.(payload.delta)
        return
      }
      if (type === 'delta' && typeof payload?.delta === 'string') {
        answer += payload.delta
        options.onMessageDelta?.(payload.delta)
        return
      }

      if (type === 'done') {
        const finalAnswer = typeof payload?.answer === 'string'
          ? payload.answer.trim()
          : answer.trim()
        handleSettle(finalAnswer || new Error('La IA no devolvio contenido.'))
        return
      }

      if (type === 'error') {
        const message = typeof payload?.message === 'string' && payload.message.trim()
          ? payload.message.trim()
          : 'No se pudo completar la consulta en Android.'
        handleSettle(new Error(message))
      }
    }

    listen<AiChatStreamEvent>('notia-ai-chat-stream', (event) => handleStreamEvent(event.payload))
      .then((unlisten) => {
        if (settled) {
          unlisten()
        } else {
          listeners.push(unlisten)
        }
      })
      .catch((error) => handleSettle(describeAiError(error, 'No se pudo escuchar el streaming.')))

    addPluginListener<AiChatStreamEvent>('AiBridgePlugin', 'stream', handleStreamEvent)
      .then((listener) => {
        if (settled) {
          void listener.unregister()
        } else {
          pluginListeners.push(listener)
        }
      })
      .catch(() => {
        // Rust's `notia-ai-chat-stream` event remains the compatibility path
        // when the optional plugin event permission is unavailable.
      })

    const invokeWithCommand = async (command: string) => {
      try {
        await invoke(command, {
          payload: {
            requestId,
            ...normalizeAiSettingsInput(preferences),
            model,
            think: options.thinking ?? false,
            prompt: input.prompt,
            previousMessages: input.previousMessages,
            longTermMemories: input.longTermMemories,
            files: input.files ?? [],
            image: input.image ?? null,
            selectedContextMode: input.selectedContextMode,
          },
        })
      } catch (error) {
        lastError = error
      }
    }

    (async () => {
      for (const command of ANDROID_AI_CHAT_STREAMING_COMMANDS) {
        await invokeWithCommand(command)
        if (settled) {
          return
        }
      }

      if (!settled) {
        handleSettle(describeAiError(lastError, 'No se pudo iniciar el streaming en Android.'))
      }
    })()
  })
}

async function invokeDesktopAiChat(
  preferences: AiPreferences,
  model: string,
  messages: AiMessagePayload[],
  options: StreamAiChatReplyOptions,
): Promise<string> {
  let lastError: unknown = null

  for (const command of DESKTOP_AI_CHAT_COMMANDS) {
    try {
      const response = await invoke<BridgeAiChatResponse>(command, {
        payload: {
          ...normalizeAiSettingsInput(preferences),
          model,
          think: options.thinking ?? false,
          messages,
        },
      })

      if (typeof response.error === 'string' && response.error.trim()) {
        throw new Error(response.error.trim())
      }

      const answer = typeof response.answer === 'string' ? response.answer.trim() : ''
      if (!answer) {
        throw new Error('La IA no devolvio contenido.')
      }

      options.onMessageDelta?.(answer)
      return answer
    } catch (error) {
      lastError = error
    }
  }

  throw describeAiError(lastError, 'No se pudo completar la consulta en desktop.')
}

function buildAiHealthCacheKey(preferences: AiPreferences): string {
  const normalized = normalizeAiSettingsInput(preferences)
  return `${normalized.ollamaUrl}::${normalized.selectedModel}::${normalized.apiKey ? 'configured' : 'missing'}`
}

export async function checkAiHealth(preferences: AiPreferences): Promise<AiHealthCheckResult> {
  const cacheKey = buildAiHealthCacheKey(preferences)
  const now = Date.now()
  if (aiHealthCache && aiHealthCacheKey === cacheKey && now - aiHealthCache.timestamp < AI_HEALTH_CACHE_TTL_MS) {
    return aiHealthCache.result
  }

  let result: AiHealthCheckResult
  if (getRuntimeDevice() === 'Android') {
    try {
      result = await invokeAndroidAiHealth(preferences)
    } catch (error) {
      result = {
        ok: false,
        message: describeAiError(error, 'No se pudo conectar con la IA en Android.').message,
      }
    }
  } else {
    try {
      result = await invokeDesktopAiHealth(preferences)
    } catch (error) {
      result = {
        ok: false,
        message: describeAiError(error, 'No se pudo conectar con Ollama en desktop.').message,
      }
    }
  }

  aiHealthCache = { result, timestamp: now }
  aiHealthCacheKey = cacheKey
  return result
}

export function invalidateAiHealthCache(): void {
  aiHealthCache = null
  aiHealthCacheKey = ''
}

export async function streamAiChatReply(
  preferences: AiPreferences,
  input: StreamAiChatReplyInput,
  options: StreamAiChatReplyOptions = {},
): Promise<string> {
  const normalizedPreferences = normalizeAiSettingsInput(preferences)
  const model = await resolveDefaultModel(normalizedPreferences)

  if (input.image?.base64.trim()) {
    const isMultimodal = await isAiModelMultimodal(normalizedPreferences, model)
    if (!isMultimodal) {
      throw new Error('El modelo seleccionado no admite imagenes. Elegi otro modelo en Settings → IA.')
    }
  }

  const messages = buildConversationMessages(input)
  const chatOptions: StreamAiChatReplyOptions = {
    ...options,
    thinking: normalizedPreferences.thinkingEnabled
      ? supportsThinkingLevels(model) ? normalizedPreferences.thinkingLevel : true
      : false,
  }

  if (getRuntimeDevice() === 'Android') {
    return invokeAndroidAiChatStreaming(normalizedPreferences, model, input, chatOptions)
  }

  try {
    return await streamDesktopAiChatViaBridge(normalizedPreferences, model, messages, chatOptions)
  } catch (nativeStreamError) {
    if (chatOptions.abortSignal?.aborted || window.__NOTIA_PUBLISHED_TASK_MANAGER__) {
      throw nativeStreamError
    }
    return invokeDesktopAiChat(normalizedPreferences, model, messages, chatOptions)
  }
}

export interface CancelableAiReplyHandle {
  abort: () => void
  promise: Promise<string>
}

export function startCancelableAiChatReply(
  preferences: AiPreferences,
  input: StreamAiChatReplyInput,
  options: StreamAiChatReplyOptions = {},
): CancelableAiReplyHandle {
  const controller = new AbortController()
  const promise = streamAiChatReply(preferences, input, {
    ...options,
    abortSignal: controller.signal,
  })

  return {
    abort: () => controller.abort(),
    promise,
  }
}

export async function recognizeInkMathWithAi(
  preferences: AiPreferences,
  image: AiImageAttachment,
  abortSignal?: AbortSignal,
): Promise<string> {
  const normalizedPreferences = normalizeAiSettingsInput(preferences)
  const model = await resolveDefaultModel(normalizedPreferences)
  const base64 = image.base64.trim()
  if (!base64) {
    throw new Error('La imagen de InkMath esta vacia.')
  }

  const prompt = [
    'Transcribi exclusivamente la formula matematica manuscrita de la imagen a LaTeX.',
    'Responde solo con el codigo LaTeX, sin delimitadores, bloques Markdown ni explicaciones.',
    'Conserva fracciones, indices, exponentes, raices, integrales, sumatorias y saltos de linea visibles.',
    'No inventes simbolos que no aparezcan en la imagen.',
  ].join(' ')
  const options: StreamAiChatReplyOptions = { abortSignal, thinking: false }

  let answer: string
  if (getRuntimeDevice() === 'Android') {
    answer = await invokeAndroidAiChat(
      normalizedPreferences,
      model,
      {
        prompt,
        previousMessages: [],
        longTermMemories: [],
        files: [],
        image,
        selectedContextMode: 'direct',
      },
      options,
    )
  } else {
    const messages: AiMessagePayload[] = [
      { role: 'system', content: 'Sos un transcriptor preciso de formulas matematicas manuscritas a LaTeX.' },
      { role: 'user', content: prompt, images: [base64] },
    ]
    answer = await invokeDesktopAiChat(normalizedPreferences, model, messages, options)
  }

  if (abortSignal?.aborted) {
    throw new DOMException('Reconocimiento cancelado.', 'AbortError')
  }

  const latex = answer
    .trim()
    .replace(/^```(?:latex|tex)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .replace(/^\$\$([\s\S]*)\$\$$/, '$1')
    .trim()
  if (!latex) {
    throw new Error('Ollama no devolvio una formula LaTeX.')
  }
  return latex
}

export async function improveMeetingTranscript(
  preferences: AiPreferences,
  transcript: string,
): Promise<string> {
  const normalizedTranscript = transcript.trim()
  if (!normalizedTranscript) throw new Error('No hay una transcripción para mejorar.')

  return streamAiChatReply(preferences, {
    prompt: [
      'Organiza y mejora la siguiente transcripción de una reunión.',
      'Corrige puntuación, ortografía, concordancia y frases evidentemente cortadas.',
      'Conserva los nombres o etiquetas de hablante exactamente como aparecen y mantén cada intervención con su hablante.',
      'No inventes información, no resumas, no elimines detalles y no agregues comentarios.',
      'Devuelve únicamente la transcripción mejorada, sin introducción ni bloque de código.',
      '',
      normalizedTranscript,
    ].join('\n'),
    previousMessages: [],
    longTermMemories: [],
    files: [],
    image: null,
    selectedContextMode: 'direct',
  }, { thinking: false })
}

async function invokeAndroidAiModelList(preferences: AiPreferences): Promise<string[]> {
  let lastError: unknown = null

  for (const command of ANDROID_AI_MODEL_LIST_COMMANDS) {
    try {
      const response = await invoke<BridgeAiModelListResponse>(command, {
        payload: normalizeAiSettingsInput(preferences),
      })

      return Array.isArray(response.models)
        ? response.models
          .filter((model): model is string => typeof model === 'string')
          .map((model) => model.trim())
          .filter(Boolean)
        : []
    } catch (error) {
      lastError = error
    }
  }

  throw describeAiError(lastError, 'No se pudo listar los modelos de IA.')
}
