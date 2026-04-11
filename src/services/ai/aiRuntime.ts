import { invoke } from '@tauri-apps/api/core'
import type { ChatFileContextMode, ChatInlineFileAttachment } from '../chat/chatAttachmentRuntime'
import type { StoredChatMessage } from '../chat/chatDocumentStorage'
import type { AiPreferences } from '../preferences/aiSettingsStorage'
import { normalizeAiSettingsInput } from '../preferences/aiSettingsStorage'
import { getRuntimeDevice } from '../../utils/platform/getRuntimeDevice'

const AI_REQUEST_TIMEOUT_MS = 15_000
const AI_CHAT_TIMEOUT_MS = 180_000
const MAX_MEMORY_ITEMS = 50
const MAX_CONTEXT_CHARS = 30_000
const DESKTOP_AI_HEALTH_COMMANDS = ['check_desktop_ai_health'] as const
const DESKTOP_AI_CHAT_COMMANDS = ['run_desktop_ai_chat'] as const
const DESKTOP_AI_MODEL_LIST_COMMANDS = ['list_desktop_ai_models'] as const
const ANDROID_AI_HEALTH_COMMANDS = [
  'check_android_ai_health',
  'mobile_ai_bridge::check_android_ai_health',
] as const
const ANDROID_AI_CHAT_COMMANDS = [
  'run_android_ai_chat',
  'mobile_ai_bridge::run_android_ai_chat',
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
  role: 'system' | 'user' | 'assistant'
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
  }
  error?: unknown
  done?: unknown
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

async function checkModelSupportsVision(preferences: AiPreferences, model: string): Promise<boolean> {
  const payload = await fetchJsonWithTimeout<OllamaShowResponse>(
    buildOllamaUrl(preferences, '/api/show'),
    {
      method: 'POST',
      headers: {
        ...buildOllamaHeaders(preferences, 'application/json'),
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

export async function listAiMultimodalModels(preferences: AiPreferences): Promise<AiModelOption[]> {
  const normalizedPreferences = normalizeAiSettingsInput(preferences)
  if (getRuntimeDevice() === 'Android') {
    try {
      const models = await invokeAndroidAiModelList(normalizedPreferences)
      return models.map((model) => ({ name: model }))
    } catch {
      // Fallback a fetch si el bridge de Android no esta disponible.
    }
  } else {
    try {
      const models = await invokeDesktopAiModelList(normalizedPreferences)
      return models.map((model) => ({ name: model }))
    } catch {
      // Fallback a fetch solo si el bridge de desktop no esta disponible.
    }
  }

  const availableModels = await fetchAvailableOllamaModels(normalizedPreferences)
  const likelyMultimodalModels = availableModels.filter((model) => isLikelyMultimodalModelName(model))
  const modelsToVerify = likelyMultimodalModels.length > 0 ? likelyMultimodalModels : availableModels.slice(0, 12)
  const verifiedModels: AiModelOption[] = []

  for (const model of modelsToVerify) {
    const supportsVision = await checkModelSupportsVision(normalizedPreferences, model).catch(() => false)
    if (supportsVision) {
      verifiedModels.push({ name: model })
    }
  }

  if (verifiedModels.length > 0) {
    return verifiedModels
  }

  // Fallback for Ollama Cloud when capability introspection is incomplete or rate-limited.
  return likelyMultimodalModels.map((model) => ({ name: model }))
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

function buildFileContextSection(
  files: ChatInlineFileAttachment[],
  selectedContextMode: ChatFileContextMode,
): string {
  if (files.length === 0) {
    return ''
  }

  const header = selectedContextMode === 'index'
    ? 'Archivos de referencia prioritaria:'
    : 'Archivos de contexto:'

  const sections: string[] = [header]
  let consumedChars = 0

  for (const file of files) {
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
    buildFileContextSection(files, selectedContextMode),
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
    const multimodalModels = await listAiMultimodalModels(preferences)
    const selectedModel = normalizeAiSettingsInput(preferences).selectedModel
    const resolvedModel = selectedModel && multimodalModels.some((model) => model.name === selectedModel)
      ? selectedModel
      : multimodalModels[0]?.name ?? ''

    return resolvedModel
      ? {
        ok: true,
        message: 'Conexion correcta con Ollama.',
        defaultModel: resolvedModel,
      }
      : {
        ok: false,
        message: 'Ollama respondio, pero no devolvio modelos multimodales disponibles.',
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

      return {
        ok: Boolean(response.ok),
        message: typeof response.message === 'string' && response.message.trim()
          ? response.message.trim()
          : Boolean(response.ok)
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

      return {
        ok: Boolean(response.ok),
        message: typeof response.message === 'string' && response.message.trim()
          ? response.message.trim()
          : Boolean(response.ok)
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
  const multimodalModels = await listAiMultimodalModels(normalizedPreferences)
  if (multimodalModels.length === 0) {
    throw new Error('No hay modelos multimodales disponibles en Ollama.')
  }

  const selectedModel = normalizedPreferences.selectedModel
  if (selectedModel && multimodalModels.some((model) => model.name === selectedModel)) {
    return selectedModel
  }

  return multimodalModels[0].name
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

export async function checkAiHealth(preferences: AiPreferences): Promise<AiHealthCheckResult> {
  if (getRuntimeDevice() === 'Android') {
    try {
      return await invokeAndroidAiHealth(preferences)
    } catch (error) {
      return {
        ok: false,
        message: describeAiError(error, 'No se pudo conectar con la IA en Android.').message,
      }
    }
  }

  try {
    return await invokeDesktopAiHealth(preferences)
  } catch {
    return checkDesktopAiHealthViaFetch(preferences)
  }
}

export async function streamAiChatReply(
  preferences: AiPreferences,
  input: StreamAiChatReplyInput,
  options: StreamAiChatReplyOptions = {},
): Promise<string> {
  const normalizedPreferences = normalizeAiSettingsInput(preferences)
  const model = await resolveDefaultModel(normalizedPreferences)
  const messages = buildConversationMessages(input)

  if (getRuntimeDevice() === 'Android') {
    return invokeAndroidAiChat(normalizedPreferences, model, input, options)
  }

  try {
    return await invokeDesktopAiChat(normalizedPreferences, model, messages, options)
  } catch {
    return streamDesktopAiChatViaFetch(normalizedPreferences, model, messages, options)
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
