import type { ChatMessage, ChatRole } from '../types/taskManagerTypes'

const MAX_CHAT_MESSAGES = 80

export function createInitialChatMessages(): ChatMessage[] {
  return [
    {
      id: 'welcome',
      role: 'assistant',
      content: 'Hola, soy tu asistente de tareas. Contame qué querés destrabar y lo ordenamos en pasos accionables.',
    },
  ]
}

export function appendChatMessage(messages: ChatMessage[], role: ChatRole, content: string): ChatMessage[] {
  const normalized = content.trim()
  if (!normalized) {
    return messages
  }

  const nextMessages = [
    ...messages,
    {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      role,
      content: normalized,
    },
  ]

  if (nextMessages.length <= MAX_CHAT_MESSAGES) {
    return nextMessages
  }

  return nextMessages.slice(nextMessages.length - MAX_CHAT_MESSAGES)
}

export function buildAssistantFallbackReply(userInput: string): string {
  const normalizedInput = userInput.trim().toLowerCase()
  if (!normalizedInput) {
    return 'Mandame un mensaje y te respondo.'
  }

  if (normalizedInput.includes('prioridad') || normalizedInput.includes('urgente')) {
    return 'Si algo es urgente, dividilo en pasos de 15-30 minutos y resolvé primero el bloqueador principal.'
  }

  if (normalizedInput.includes('pomodoro') || normalizedInput.includes('foco')) {
    return 'Probá 25 minutos de foco + 5 de descanso, con una sola tarea activa por ciclo.'
  }

  if (normalizedInput.includes('bloque') || normalizedInput.includes('trabado') || normalizedInput.includes('destrabar')) {
    return 'Para destrabar: 1) definí el próximo paso mínimo, 2) asignale 20 minutos, 3) empezá sin optimizar.'
  }

  if (normalizedInput.includes('resumen') || normalizedInput.includes('outline')) {
    return 'Puedo ayudarte a resumir. Pegá tu texto y te lo ordeno por prioridad.'
  }

  return 'Perfecto. Si querés una propuesta concreta, pasame objetivo, bloqueo y fecha límite.'
}
