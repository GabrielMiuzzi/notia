import { Bell, Clock, Repeat, type LucideIcon } from 'lucide-react'
import type { AiActionKind } from '../types/aiActionsTypes'

/** Ícono y acento de cada columna (solo presentación). */
export const KIND_VISUALS: Record<AiActionKind, { icon: LucideIcon; accent: string }> = {
  reminder: { icon: Bell, accent: 'violet' },
  'one-shot': { icon: Clock, accent: 'periwinkle' },
  recurring: { icon: Repeat, accent: 'gold' },
}
