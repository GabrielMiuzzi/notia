import type { ChatStarter } from './ChatWorkspaceViewTypes'

/** Questions a new chat offers to start with. */
export const DEFAULT_CHAT_STARTERS: ChatStarter[] = [
  {
    title: 'Resumí estas notas',
    description: 'Síntesis de las notas o carpetas que elijas como contexto.',
    prompt: 'Resume estas notas',
  },
  {
    title: 'Conectá ideas relacionadas',
    description: 'Encontrá vínculos entre notas de la librería.',
    prompt: 'Conecta ideas relacionadas',
  },
  {
    title: 'Próximos pasos concretos',
    description: 'Convertí pendientes en acciones claras.',
    prompt: 'Dame proximos pasos concretos',
  },
]
