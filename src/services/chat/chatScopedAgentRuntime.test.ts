import { describe, expect, it } from 'vitest'
import {
  buildChatAgentSystemPrompt,
  buildChatAgentTools,
  buildTicketSectionCorrection,
  buildAgentSearchText,
  groupTaskContextMatches,
  normalizeAgentSearchText,
  scoreAgentText,
  selectDiverseAgentFragments,
} from './chatScopedAgentRuntime'

describe('chatScopedAgentRuntime', () => {
  it('normalizes accents, punctuation and case for title matching', () => {
    expect(normalizeAgentSearchText('  Migración: AUTENTICACIÓN.md ')).toBe('migracion autenticacion md')
  })

  it('ranks an exact phrase above scattered matching terms', () => {
    expect(scoreAgentText('sincronizacion android', 'Plan de sincronización Android'))
      .toBeGreaterThan(scoreAgentText('sincronizacion android', 'Android y otras notas de sincronización'))
  })

  it('includes folder paths in the RAG search text', () => {
    const searchText = buildAgentSearchText({
      name: 'Chat-2026-08-19-14-13-11.md',
      relativePath: 'chat/chats/Chat-2026-08-19-14-13-11.md',
    }, 'Contenido sin mencionar el nombre de la carpeta.')

    expect(scoreAgentText('chats', searchText)).toBeGreaterThan(0)
  })

  it('diversifies RAG fragments across matching files before repeating one file', () => {
    const fragments = selectDiverseAgentFragments([
      { documentId: 'doc-1', title: 'Historial', path: 'Historial.md', content: 'Doris 1', score: 120 },
      { documentId: 'doc-1', title: 'Historial', path: 'Historial.md', content: 'Doris 2', score: 110 },
      { documentId: 'doc-2', title: 'Transferencias', path: 'Transferencias.md', content: 'Doris', score: 30 },
      { documentId: 'doc-3', title: 'Depósitos', path: 'Depositos.md', content: 'Doris', score: 20 },
    ], 3)

    expect(fragments.map((fragment) => fragment.path)).toEqual([
      'Historial.md',
      'Transferencias.md',
      'Depositos.md',
    ])
  })

  it('groups Task Manager fragments by ticket and preserves readable ticket IDs', () => {
    expect(groupTaskContextMatches([
      { documentId: 'doc-1', title: 'Historial', path: 'Historial.md', content: 'Leandro 1', score: 120 },
      { documentId: 'doc-2', title: 'Métrica', path: 'Metrica.md', content: 'Leandro', score: 30 },
      { documentId: 'doc-1', title: 'Historial', path: 'Historial.md', content: 'Leandro 2', score: 20 },
    ])).toEqual([
      {
        ticketId: 'doc-1',
        title: 'Historial',
        path: 'Historial.md',
        fragments: ['Leandro 1', 'Leandro 2'],
      },
      {
        ticketId: 'doc-2',
        title: 'Métrica',
        path: 'Metrica.md',
        fragments: ['Leandro'],
      },
    ])
  })

  it('rejects a multi-ticket answer that merges fields under one heading', () => {
    const tickets = [
      { title: 'Alta de prontopago.md', path: 'default/Alta de prontopago.md' },
      { title: 'Métrica de disponibilidad.md', path: 'default/Métrica de disponibilidad.md' },
    ]
    const mergedAnswer = [
      '## 1. Alta de prontopago',
      '- Estado: Pendiente',
      '- Estado: En progreso',
      '- Detalle: Métrica de disponibilidad',
    ].join('\n')

    const correction = buildTicketSectionCorrection(mergedAnswer, tickets)

    expect(correction).toContain('exactamente 2 secciones independientes')
    expect(correction).toContain('Métrica de disponibilidad.md')
  })

  it('does not treat Path bullets as independent ticket headings', () => {
    const tickets = [
      { title: 'Alta de prontopago.md', path: 'default/Alta de prontopago.md' },
      { title: 'Métrica de disponibilidad.md', path: 'default/Métrica de disponibilidad.md' },
    ]
    const answerWithPathBullets = [
      '## 1. Alta de prontopago',
      '- **Path:** task-mannager/default/Alta de prontopago.md',
      '- **Estado:** Pendiente',
      '- **Path:** task-mannager/default/Métrica de disponibilidad.md',
      '- **Estado:** En progreso',
    ].join('\n')

    const correction = buildTicketSectionCorrection(answerWithPathBullets, tickets)

    expect(correction).toContain('## 2. Métrica de disponibilidad.md')
    expect(correction).toContain('una viñeta Path no cuenta como encabezado')
  })

  it('rejects a declared ticket count even when no expected paths were tracked', () => {
    const mergedAnswer = [
      'Leandro está involucrado en las siguientes 5 tareas:',
      '## 1. Alta de prontopago',
      '- Estado: Pendiente',
      '- Estado: En progreso',
      '- Estado: En progreso',
      '- Estado: Pendiente',
      '- Estado: Pendiente',
    ].join('\n')

    const correction = buildTicketSectionCorrection(mergedAnswer, [])

    expect(correction).toContain('hay 5 tickets')
    expect(correction).toContain('solo contiene 1 encabezados')
    expect(correction).toContain('exactamente 5 secciones')
  })

  it('accepts a multi-ticket answer with one heading per ticket', () => {
    const tickets = [
      { title: 'Alta de prontopago.md', path: 'default/Alta de prontopago.md' },
      { title: 'Métrica de disponibilidad.md', path: 'default/Métrica de disponibilidad.md' },
    ]
    const separatedAnswer = [
      '## 1. Alta de prontopago',
      '- Estado: Pendiente',
      '## 2. Métrica de disponibilidad',
      '- Estado: En progreso',
    ].join('\n')

    expect(buildTicketSectionCorrection(separatedAnswer, tickets)).toBeNull()
  })

  it('exposes only Task Manager tools in the task scope', () => {
    const names = buildChatAgentTools('task-manager').map((tool) => tool.function.name)
    expect(names).toContain('search_task_context')
    expect(names).toContain('read_task_tickets')
    expect(names).toContain('read_all_task_tickets')
    expect(names).not.toContain('search_library_context')
    expect(names).not.toContain('request_file_read_permission')
  })

  it('requires file permission only in the document scope', () => {
    const names = buildChatAgentTools('document').map((tool) => tool.function.name)
    expect(names).toContain('request_file_read_permission')
    expect(buildChatAgentSystemPrompt('document')).toContain('Solo el archivo activo esta autorizado')
  })

  it('instructs Task Manager to use RAG before full reads', () => {
    const prompt = buildChatAgentSystemPrompt('task-manager')
    expect(prompt).toContain('usa primero search_task_context')
    expect(prompt).toContain('debes llamar read_all_task_tickets')
    expect(prompt).toContain('nunca sirve para afirmar que encontraste todos')
    expect(prompt).toContain('read_task_tickets solo si')
  })

  it('requires exhaustive per-person summaries to inspect every ticket independently', () => {
    const prompt = buildChatAgentSystemPrompt('task-manager')
    const exhaustiveTool = buildChatAgentTools('task-manager')
      .find((tool) => tool.function.name === 'read_all_task_tickets')

    expect(exhaustiveTool?.function.description).toContain('cada persona')
    expect(prompt).toContain('recorre cada ticket de forma independiente')
    expect(prompt).toContain('Construye primero el conjunto completo de personas')
    expect(prompt).toContain('Una tarea puede aparecer bajo mas de una persona')
    expect(prompt).toContain('menciones incidentales')
    expect(prompt).toContain('cantidad de rutas unicas encontradas')
    expect(prompt).toContain('todos sus ticketId unicos')
    expect(prompt).toContain('una seccion separada por cada ruta leida')
  })

  it('uses the library prompt while retaining scope restrictions', () => {
    const prompt = buildChatAgentSystemPrompt('task-manager', 'Responde siempre en español.')
    expect(prompt).toContain('Responde siempre en español.')
    expect(prompt).toContain('Estas en Task Manager.')
  })

  it('instructs Graph View to resolve named folders by path', () => {
    const prompt = buildChatAgentSystemPrompt('graph')
    expect(prompt).toContain('rutas o carpetas nombradas')
    expect(prompt).toContain('cuya ruta esta dentro de esa carpeta')
  })
})
