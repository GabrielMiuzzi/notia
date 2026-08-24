import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { ChatFileContextMode, ChatInlineFileAttachment } from '../chat/chatAttachmentRuntime'
import type { StoredChatMessage } from '../chat/chatDocumentStorage'
import type { AiPreferences } from '../preferences/aiSettingsStorage'
import { normalizeAiSettingsInput } from '../preferences/aiSettingsStorage'
import { getRuntimeDevice } from '../../utils/platform/getRuntimeDevice'

const AI_REQUEST_TIMEOUT_MS = 15_000
const AI_CHAT_TIMEOUT_MS = 180_000
const AI_TOOL_AGENT_TIMEOUT_MS = 600_000
const AI_HEALTH_CACHE_TTL_MS = 10_000
const MAX_MEMORY_ITEMS = 50
const MAX_CONTEXT_CHARS = 30_000
const MAX_INDEX_CONTEXT_FILES = 50
const MAX_INDEX_CONTEXT_CHARS = 6_000

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
const ANDROID_AI_MODEL_LIST_COMMANDS = [
  'list_android_ai_models',
  'mobile_ai_bridge::list_android_ai_models',
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
}

export interface InkdocOcrBlock {
  type: 'text' | 'latex'
  content: string
}

interface AiMessagePayload {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  images?: string[]
  tool_name?: string
  tool_calls?: AiNativeToolCall[]
}

export interface AiNativeToolCall {
  function: {
    name: string
    arguments: Record<string, unknown>
  }
}

export interface AiNativeToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export interface NativeToolAgentInput {
  systemPrompt: string
  prompt: string
  previousMessages: StoredChatMessage[]
  tools: AiNativeToolDefinition[]
  executeTool: (call: AiNativeToolCall, signal: AbortSignal) => Promise<unknown>
  validateFinalAnswer?: (answer: string) => string | null
  maxRounds?: number
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
  thinking?: boolean | 'low' | 'medium' | 'high'
  abortSignal?: AbortSignal
}

interface GenerateAiChatTitleInput {
  prompt: string
}

interface GenerateAiLongTermMemoriesInput {
  prompt: string
  assistantReply: string
  previousMessages: StoredChatMessage[]
  existingLongTermMemories: string[]
}

interface OllamaTagsResponse {
  models?: Array<{
    name?: unknown
    model?: unknown
  }>
}

interface OllamaShowResponse {
  capabilities?: unknown
}

interface OllamaStreamChunk {
  message?: {
    content?: unknown
    thinking?: unknown
  }
  error?: unknown
  done?: unknown
}

interface OllamaNativeToolResponse {
  message?: {
    role?: unknown
    content?: unknown
    thinking?: unknown
    tool_calls?: unknown
  }
  error?: unknown
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

  return new Error(fallback)
}

function buildOllamaUrl(preferences: AiPreferences, path: string): string {
  const normalizedPreferences = normalizeAiSettingsInput(preferences)
  return `${normalizedPreferences.ollamaUrl}${path}`
}

function buildOllamaHeaders(preferences: AiPreferences, accept: string): HeadersInit {
  const normalizedPreferences = normalizeAiSettingsInput(preferences)
  const headers: Record<string, string> = {
    Accept: accept,
  }

  if (normalizedPreferences.apiKey) {
    headers.Authorization = `Bearer ${normalizedPreferences.apiKey}`
  }

  return headers
}

async function fetchJsonWithTimeout<TResponse>(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<TResponse> {
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
    })

    if (!response.ok) {
      const detail = await response.text()
      throw new Error(detail || `La IA respondio con HTTP ${response.status}.`)
    }

    return response.json() as Promise<TResponse>
  } catch (error) {
    throw describeAiError(error, 'No se pudo conectar con la IA.')
  } finally {
    window.clearTimeout(timeoutId)
  }
}

function extractModelName(model: unknown): string {
  if (!model || typeof model !== 'object') {
    return ''
  }

  const candidate = model as { name?: unknown; model?: unknown }
  return typeof candidate.name === 'string'
    ? candidate.name.trim()
    : typeof candidate.model === 'string'
      ? candidate.model.trim()
      : ''
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
      if (type === 'thinking' && typeof payload?.delta === 'string') {
        options.onThinkingDelta?.(payload.delta)
      } else if (type === 'delta' && typeof payload?.delta === 'string') {
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

async function fetchAvailableOllamaModels(preferences: AiPreferences): Promise<string[]> {
  const payload = await fetchJsonWithTimeout<OllamaTagsResponse>(
    buildOllamaUrl(preferences, '/api/tags'),
    {
      method: 'GET',
      headers: buildOllamaHeaders(preferences, 'application/json'),
    },
    AI_REQUEST_TIMEOUT_MS,
  )

  return Array.isArray(payload.models)
    ? payload.models.map((model) => extractModelName(model)).filter(Boolean)
    : []
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

export async function checkModelSupportsVision(preferences: AiPreferences, model: string): Promise<boolean> {
  const normalizedPreferences = normalizeAiSettingsInput(preferences)
  const payload = await fetchJsonWithTimeout<OllamaShowResponse>(
    buildOllamaUrl(normalizedPreferences, '/api/show'),
    {
      method: 'POST',
      headers: {
        ...buildOllamaHeaders(normalizedPreferences, 'application/json'),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
      }),
    },
    AI_REQUEST_TIMEOUT_MS,
  )

  return Array.isArray(payload.capabilities)
    && payload.capabilities.some((capability) => capability === 'vision')
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
    const payload = await fetchJsonWithTimeout<OllamaShowResponse>(
      buildOllamaUrl(preferences, '/api/show'),
      {
        method: 'POST',
        headers: {
          ...buildOllamaHeaders(preferences, 'application/json'),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model: name }),
      },
      AI_REQUEST_TIMEOUT_MS,
    )
    const capabilities = Array.isArray(payload.capabilities)
      ? payload.capabilities.filter((capability): capability is string => typeof capability === 'string')
      : []
    return {
      name,
      supportsThinking: capabilities.includes('thinking') || fallback.supportsThinking,
      supportsThinkingLevels: fallback.supportsThinkingLevels,
      supportsVision: capabilities.includes('vision') || fallback.supportsVision,
      supportsTools: capabilities.includes('tools') || fallback.supportsTools,
    }
  } catch {
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
  return `${normalized.ollamaUrl}::${normalized.apiKey}`
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

  let names: string[] = []
  try {
    names = await fetchAvailableOllamaModels(normalizedPreferences)
  } catch {
    // The native bridge remains a fallback for runtimes where direct fetch is unavailable.
  }

  if (names.length === 0) {
    names = await listAiModelsFromBridge(normalizedPreferences)
  }

  const uniqueNames = Array.from(new Set(names)).sort((left, right) => left.localeCompare(right, 'en'))
  const models = await mapWithConcurrency(uniqueNames, 4, (name) => loadAiModelOption(normalizedPreferences, name))
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
    images: input.image?.base64.trim()
      ? [input.image.base64.trim()]
      : undefined,
  }

  return [systemMessage, ...historyMessages, userMessage]
}

function extractJsonArrayCandidate(value: string): string {
  const fencedMatch = /```(?:json)?\s*([\s\S]*?)```/i.exec(value)
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim()
  }

  const firstBracketIndex = value.indexOf('[')
  const lastBracketIndex = value.lastIndexOf(']')
  if (firstBracketIndex >= 0 && lastBracketIndex > firstBracketIndex) {
    return value.slice(firstBracketIndex, lastBracketIndex + 1)
  }

  return value.trim()
}

function extractJsonObjectCandidate(value: string): string {
  const fencedMatch = /```(?:json)?\s*([\s\S]*?)```/i.exec(value)
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim()
  }

  const firstBraceIndex = value.indexOf('{')
  const lastBraceIndex = value.lastIndexOf('}')
  if (firstBraceIndex >= 0 && lastBraceIndex > firstBraceIndex) {
    return value.slice(firstBraceIndex, lastBraceIndex + 1)
  }

  return value.trim()
}

function parseInkdocOcrBlocks(value: string): InkdocOcrBlock[] {
  const candidate = extractJsonObjectCandidate(value)

  try {
    const parsed = JSON.parse(candidate) as { blocks?: unknown }
    if (!Array.isArray(parsed.blocks)) {
      return []
    }

    return parsed.blocks.flatMap((block) => {
      if (!block || typeof block !== 'object') {
        return []
      }

      const candidateBlock = block as { type?: unknown; content?: unknown }
      const type = candidateBlock.type === 'latex' ? 'latex' : candidateBlock.type === 'text' ? 'text' : null
      const content = typeof candidateBlock.content === 'string' ? candidateBlock.content.trim() : ''
      if (!type || !content) {
        return []
      }

      return [{ type, content }]
    })
  } catch {
    return []
  }
}

function parseGeneratedMemoryList(value: string): string[] {
  const candidate = extractJsonArrayCandidate(value)

  try {
    const parsed = JSON.parse(candidate)
    if (Array.isArray(parsed)) {
      return parsed
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
    }

    if (parsed && typeof parsed === 'object') {
      const memories = 'memories' in parsed ? (parsed as { memories?: unknown }).memories : null
      if (Array.isArray(memories)) {
        return memories
          .filter((item): item is string => typeof item === 'string')
          .map((item) => item.trim())
          .filter(Boolean)
      }
    }
  } catch {
    // Fallback a parsing por lineas si la IA no devolvio JSON valido.
  }

  return value
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*]\s*/, '').trim())
    .filter(Boolean)
}

function sanitizeGeneratedTitle(value: string): string {
  return value
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
}

function buildTitleGenerationMessages(prompt: string): AiMessagePayload[] {
  const normalizedPrompt = prompt.trim()

  return [
    {
      role: 'system',
      content: [
        'Genera un titulo muy corto para un chat.',
        'Responde solo con el titulo.',
        'No uses comillas.',
        'Maximo 6 palabras.',
        'Debe sonar natural y describir el pedido del usuario.',
      ].join(' '),
    },
    {
      role: 'user',
      content: `Mensaje inicial del usuario:\n${normalizedPrompt}`,
    },
  ]
}

function buildLongTermMemoryGenerationMessages(input: GenerateAiLongTermMemoriesInput): AiMessagePayload[] {
  const normalizedExistingMemories = input.existingLongTermMemories
    .map((memory) => memory.trim())
    .filter(Boolean)
    .slice(0, MAX_MEMORY_ITEMS)

  const previousConversation = input.previousMessages
    .map((message) => `${message.role}: ${message.content.trim()}`)
    .filter((message) => !message.endsWith(':'))
    .slice(-10)
    .join('\n')

  const sections = [
    'Memorias ya guardadas:',
    normalizedExistingMemories.length > 0
      ? JSON.stringify(normalizedExistingMemories, null, 2)
      : '[]',
    '',
    'Contexto reciente del chat:',
    previousConversation || '(sin mensajes previos)',
    '',
    'Ultimo mensaje del usuario:',
    input.prompt.trim(),
    '',
    'Ultima respuesta del asistente:',
    input.assistantReply.trim(),
  ]

  return [
    {
      role: 'system',
      content: [
        'Extrae memorias de largo plazo nuevas y utiles para el usuario.',
        'Devuelve solo un JSON array de strings.',
        'Cada item debe ser un hecho estable, preferencia, gusto o dato personal explicito y util.',
        'Si el usuario dijo su nombre, gustos, profesion, ubicacion, estudios, objetivos o preferencias duraderas, debes extraerlo.',
        'No repitas memorias ya existentes.',
        'Si no hay nada nuevo o duradero, devuelve [].',
        'No expliques nada fuera del JSON.',
        'Ejemplo valido: ["El nombre del usuario es Gabriel.", "Al usuario le gusta la electronica y la musica."]',
      ].join(' '),
    },
    {
      role: 'user',
      content: sections.join('\n'),
    },
  ]
}

function buildInkdocOcrMessages(image: AiImageAttachment): AiMessagePayload[] {
  return [
    {
      role: 'system',
      content: [
        'Sos un OCR estructurado para Notia InkDoc.',
        'Analiza escritura manuscrita y formulas matematicas.',
        'Debes responder solo JSON valido.',
        'Formato exacto: {"blocks":[{"type":"text"|"latex","content":"..."}]}',
        'Usa type="text" para lenguaje natural y type="latex" para expresiones o bloques matematicos.',
        'Si hay mezcla de texto y formulas, separalas en bloques distintos y manten el orden visual de arriba hacia abajo.',
        'En bloques latex devuelve solo el contenido LaTeX, sin fences y sin texto extra.',
        'No inventes contenido que no se vea.',
      ].join(' '),
    },
    {
      role: 'user',
      content: [
        'Convierte esta seleccion manuscrita en bloques estructurados.',
        'Si hay parrafos y formulas separadas, devuelve multiples bloques.',
        'Si una formula es multilinea, conserva su estructura.',
        'No agregues explicaciones.',
      ].join('\n'),
      images: [image.base64.trim()],
    },
  ]
}

async function checkDesktopAiHealthViaFetch(preferences: AiPreferences): Promise<AiHealthCheckResult> {
  try {
    const allModels = await listAiModels(preferences)
    const selectedModel = normalizeAiSettingsInput(preferences).selectedModel
    const resolvedModel = selectedModel && allModels.some((model) => model.name === selectedModel)
      ? selectedModel
      : allModels[0]?.name ?? ''

    return resolvedModel
      ? {
        ok: true,
        message: 'Conexion correcta con Ollama.',
        defaultModel: resolvedModel,
      }
      : {
        ok: false,
        message: 'Ollama respondio, pero no devolvio modelos disponibles.',
      }
  } catch (error) {
    return {
      ok: false,
      message: describeAiError(error, 'No se pudo conectar con Ollama.').message,
    }
  }
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

  return new Promise((resolve, reject) => {
    let answer = ''
    let settled = false

    const cleanup = () => {
      settled = true
      listeners.forEach((unlisten) => unlisten())
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
      handleSettle(new Error('Se cancelo la respuesta de la IA.'))
    }
    options.abortSignal?.addEventListener('abort', onAbort, { once: true })

    listen<AiChatStreamEvent>('notia-ai-chat-stream', (event) => {
      if (event.payload.requestId !== requestId) {
        return
      }

      const { type, payload } = event.payload
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
    })
      .then((unlisten) => listeners.push(unlisten))
      .catch((error) => handleSettle(describeAiError(error, 'No se pudo escuchar el streaming.')))

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

async function streamDesktopAiChatViaFetch(
  preferences: AiPreferences,
  model: string,
  messages: AiMessagePayload[],
  options: StreamAiChatReplyOptions,
): Promise<string> {
  const controller = new AbortController()
  options.abortSignal?.addEventListener('abort', () => controller.abort(), { once: true })
  const timeoutId = window.setTimeout(() => controller.abort(), AI_CHAT_TIMEOUT_MS)

  try {
    const response = await fetch(buildOllamaUrl(preferences, '/api/chat'), {
      method: 'POST',
      headers: {
        ...buildOllamaHeaders(preferences, 'application/x-ndjson'),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        stream: true,
        think: options.thinking ?? false,
        messages,
      }),
      signal: controller.signal,
    })

    if (!response.ok) {
      const detail = await response.text()
      throw new Error(detail || `La IA respondio con HTTP ${response.status}.`)
    }

    if (!response.body) {
      throw new Error('La IA no devolvio un stream legible.')
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let answer = ''
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done })

      let lineBreakIndex = buffer.indexOf('\n')
      while (lineBreakIndex >= 0) {
        const rawLine = buffer.slice(0, lineBreakIndex).trim()
        buffer = buffer.slice(lineBreakIndex + 1)

        if (rawLine) {
          const payload = JSON.parse(rawLine) as OllamaStreamChunk
          if (typeof payload.error === 'string' && payload.error.trim()) {
            throw new Error(payload.error.trim())
          }

          const thinkingDelta = typeof payload.message?.thinking === 'string'
            ? payload.message.thinking
            : ''
          if (thinkingDelta) {
            options.onThinkingDelta?.(thinkingDelta)
          }

          const delta = typeof payload.message?.content === 'string'
            ? payload.message.content
            : ''
          if (delta) {
            answer += delta
            options.onMessageDelta?.(delta)
          }
        }

        lineBreakIndex = buffer.indexOf('\n')
      }

      if (done) {
        break
      }
    }

    if (buffer.trim()) {
      const payload = JSON.parse(buffer.trim()) as OllamaStreamChunk
      const thinkingDelta = typeof payload.message?.thinking === 'string'
        ? payload.message.thinking
        : ''
      if (thinkingDelta) {
        options.onThinkingDelta?.(thinkingDelta)
      }
      const delta = typeof payload.message?.content === 'string'
        ? payload.message.content
        : ''
      if (delta) {
        answer += delta
        options.onMessageDelta?.(delta)
      }
    }

    const normalizedAnswer = answer.trim()
    if (!normalizedAnswer) {
      throw new Error('La IA no devolvio contenido.')
    }

    return normalizedAnswer
  } catch (error) {
    throw describeAiError(error, 'No se pudo completar la consulta con Ollama.')
  } finally {
    window.clearTimeout(timeoutId)
  }
}

function buildAiHealthCacheKey(preferences: AiPreferences): string {
  const normalized = normalizeAiSettingsInput(preferences)
  return `${normalized.ollamaUrl}::${normalized.selectedModel}::${normalized.apiKey}`
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
    } catch {
      result = await checkDesktopAiHealthViaFetch(preferences)
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

export function parseNativeToolCalls(value: unknown): AiNativeToolCall[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object') {
      return []
    }
    const fn = (candidate as { function?: unknown }).function
    if (!fn || typeof fn !== 'object') {
      return []
    }
    const name = (fn as { name?: unknown }).name
    const rawArgs = (fn as { arguments?: unknown }).arguments
    let args: unknown = rawArgs
    if (typeof rawArgs === 'string') {
      try {
        args = JSON.parse(rawArgs) as unknown
      } catch {
        return []
      }
    }
    if (typeof name !== 'string' || !name.trim() || !args || typeof args !== 'object' || Array.isArray(args)) {
      return []
    }
    return [{ function: { name: name.trim(), arguments: args as Record<string, unknown> } }]
  })
}

export async function runNativeToolAgent(
  preferences: AiPreferences,
  input: NativeToolAgentInput,
  options: StreamAiChatReplyOptions = {},
): Promise<string> {
  const normalizedPreferences = normalizeAiSettingsInput(preferences)
  const model = await resolveDefaultModel(normalizedPreferences)
  const controller = new AbortController()
  const abort = () => controller.abort()
  options.abortSignal?.addEventListener('abort', abort, { once: true })
  const timeoutId = window.setTimeout(abort, AI_TOOL_AGENT_TIMEOUT_MS)
  const messages: AiMessagePayload[] = [
    { role: 'system', content: input.systemPrompt.trim() },
    ...input.previousMessages.map((message) => ({ role: message.role, content: message.content })),
    { role: 'user', content: input.prompt.trim() },
  ]

  try {
    const maxRounds = Math.min(10, Math.max(1, input.maxRounds ?? 6))
    for (let round = 0; round < maxRounds; round += 1) {
      options.onThinkingDelta?.(
        round === 0
          ? 'Analizando la consulta y eligiendo herramientas…\n'
          : 'Procesando los resultados recuperados…\n',
      )
      const requestPayload = {
        ...normalizeAiSettingsInput(normalizedPreferences),
        model,
        think: normalizedPreferences.thinkingEnabled
          ? supportsThinkingLevels(model) ? normalizedPreferences.thinkingLevel : true
          : false,
        messages,
        tools: input.tools,
      }
      let payload: OllamaNativeToolResponse
      if (getRuntimeDevice() === 'Android') {
        const response = await fetch(buildOllamaUrl(normalizedPreferences, '/api/chat'), {
          method: 'POST',
          headers: {
            ...buildOllamaHeaders(normalizedPreferences, 'application/json'),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ ...requestPayload, stream: false }),
          signal: controller.signal,
        })
        if (!response.ok) {
          const detail = await response.text()
          throw new Error(detail || `La IA respondio con HTTP ${response.status}.`)
        }
        payload = await response.json() as OllamaNativeToolResponse
      } else {
        payload = await invoke<OllamaNativeToolResponse>('run_desktop_ai_tool_chat', {
          payload: requestPayload,
        })
        if (controller.signal.aborted) {
          throw new Error('Se cancelo la respuesta de la IA.')
        }
      }
      if (typeof payload.error === 'string' && payload.error.trim()) {
        throw new Error(payload.error.trim())
      }
      const content = typeof payload.message?.content === 'string' ? payload.message.content : ''
      const thinking = typeof payload.message?.thinking === 'string' ? payload.message.thinking : ''
      if (thinking) {
        options.onThinkingDelta?.(thinking)
      }
      const toolCalls = parseNativeToolCalls(payload.message?.tool_calls)
      messages.push({ role: 'assistant', content, tool_calls: toolCalls })

      if (toolCalls.length === 0) {
        const answer = content.trim()
        if (!answer) {
          throw new Error('La IA no devolvio contenido ni solicito herramientas.')
        }
        const correctionPrompt = input.validateFinalAnswer?.(answer) ?? null
        if (correctionPrompt) {
          options.onThinkingDelta?.('Verificando que la respuesta separe correctamente los resultados…\n')
          messages.push({ role: 'user', content: correctionPrompt })
          continue
        }
        options.onMessageDelta?.(answer)
        return answer
      }

      for (const call of toolCalls) {
        options.onThinkingDelta?.(`Ejecutando ${call.function.name}…\n`)
        const result = await input.executeTool(call, controller.signal)
        messages.push({
          role: 'tool',
          tool_name: call.function.name,
          content: JSON.stringify(result),
        })
      }
    }

    throw new Error('El agente alcanzo el limite de llamadas a herramientas.')
  } catch (error) {
    throw describeAiError(error, 'No se pudo completar la consulta con herramientas de Ollama.')
  } finally {
    window.clearTimeout(timeoutId)
    options.abortSignal?.removeEventListener('abort', abort)
  }
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
    if (chatOptions.abortSignal?.aborted) {
      throw nativeStreamError
    }
  }

  try {
    return await streamDesktopAiChatViaFetch(normalizedPreferences, model, messages, chatOptions)
  } catch (streamError) {
    if (chatOptions.abortSignal?.aborted) {
      throw streamError
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

export async function generateAiChatTitle(
  preferences: AiPreferences,
  input: GenerateAiChatTitleInput,
): Promise<string> {
  const normalizedPrompt = input.prompt.trim()
  if (!normalizedPrompt) {
    throw new Error('No hay mensaje para generar el titulo del chat.')
  }

  const normalizedPreferences = normalizeAiSettingsInput(preferences)
  const model = await resolveDefaultModel(normalizedPreferences)

  if (getRuntimeDevice() === 'Android') {
    const answer = await invokeAndroidAiChat(
      normalizedPreferences,
      model,
      {
        prompt: [
          'Genera un titulo muy corto para un chat.',
          'Responde solo con el titulo, sin comillas y con maximo 6 palabras.',
          '',
          `Mensaje inicial del usuario: ${normalizedPrompt}`,
        ].join('\n'),
        previousMessages: [],
        longTermMemories: [],
        files: [],
        image: null,
        selectedContextMode: 'direct',
      },
      {},
    )
    const title = sanitizeGeneratedTitle(answer)
    if (!title) {
      throw new Error('La IA no devolvio un titulo valido.')
    }
    return title
  }

  const messages = buildTitleGenerationMessages(normalizedPrompt)

  try {
    const answer = await invokeDesktopAiChat(normalizedPreferences, model, messages, {})
    const title = sanitizeGeneratedTitle(answer)
    if (!title) {
      throw new Error('La IA no devolvio un titulo valido.')
    }
    return title
  } catch {
    const answer = await streamDesktopAiChatViaFetch(normalizedPreferences, model, messages, {})
    const title = sanitizeGeneratedTitle(answer)
    if (!title) {
      throw new Error('La IA no devolvio un titulo valido.')
    }
    return title
  }
}

export async function generateAiLongTermMemories(
  preferences: AiPreferences,
  input: GenerateAiLongTermMemoriesInput,
): Promise<string[]> {
  const normalizedPrompt = input.prompt.trim()
  const normalizedAssistantReply = input.assistantReply.trim()
  if (!normalizedPrompt || !normalizedAssistantReply) {
    return []
  }

  const normalizedPreferences = normalizeAiSettingsInput(preferences)
  const model = await resolveDefaultModel(normalizedPreferences)

  if (getRuntimeDevice() === 'Android') {
    const answer = await invokeAndroidAiChat(
      normalizedPreferences,
      model,
      {
        prompt: [
          'Extrae memorias de largo plazo nuevas y utiles para el usuario.',
          'Devuelve solo un JSON array de strings.',
          'Debes extraer hechos estables, gustos, preferencias y datos personales explicitos si aparecen.',
          'No repitas memorias ya existentes. Si no hay nada nuevo, devuelve [].',
          'Ejemplo valido: ["El nombre del usuario es Gabriel.", "Al usuario le gusta la electronica y la musica."]',
          '',
          `Memorias ya guardadas: ${JSON.stringify(input.existingLongTermMemories)}`,
          '',
          `Ultimo mensaje del usuario: ${normalizedPrompt}`,
          '',
          `Ultima respuesta del asistente: ${normalizedAssistantReply}`,
        ].join('\n'),
        previousMessages: input.previousMessages,
        longTermMemories: [],
        files: [],
        image: null,
        selectedContextMode: 'direct',
      },
      {},
    )

    return parseGeneratedMemoryList(answer)
  }

  const messages = buildLongTermMemoryGenerationMessages(input)

  try {
    const answer = await invokeDesktopAiChat(normalizedPreferences, model, messages, {})
    return parseGeneratedMemoryList(answer)
  } catch {
    const answer = await streamDesktopAiChatViaFetch(normalizedPreferences, model, messages, {})
    return parseGeneratedMemoryList(answer)
  }
}

export async function recognizeInkdocSelectionWithAi(
  preferences: AiPreferences,
  image: AiImageAttachment,
): Promise<InkdocOcrBlock[]> {
  const normalizedPreferences = normalizeAiSettingsInput(preferences)
  const model = await resolveDefaultModel(normalizedPreferences)

  if (!image.base64.trim()) {
    throw new Error('La imagen OCR esta vacia.')
  }

  if (getRuntimeDevice() === 'Android') {
    const answer = await invokeAndroidAiChat(
      normalizedPreferences,
      model,
      {
        prompt: [
          'Convierte esta seleccion manuscrita en JSON.',
          'Responde solo con {"blocks":[{"type":"text"|"latex","content":"..."}]}.',
          'Separa texto natural y formulas matematicas en bloques distintos.',
          'Mantene el orden visual.',
        ].join('\n'),
        previousMessages: [],
        longTermMemories: [],
        files: [],
        image,
        selectedContextMode: 'direct',
      },
      {},
    )

    return parseInkdocOcrBlocks(answer)
  }

  const messages = buildInkdocOcrMessages(image)

  try {
    const answer = await invokeDesktopAiChat(normalizedPreferences, model, messages, {})
    return parseInkdocOcrBlocks(answer)
  } catch {
    const answer = await streamDesktopAiChatViaFetch(normalizedPreferences, model, messages, {})
    return parseInkdocOcrBlocks(answer)
  }
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
