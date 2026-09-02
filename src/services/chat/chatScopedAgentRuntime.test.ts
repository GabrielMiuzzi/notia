import { describe, expect, it } from 'vitest'
import {
  buildChatAgentSystemPrompt,
  buildChatAgentTools,
  validateFinanceFinalAnswer,
  buildTicketSectionCorrection,
  buildAgentSearchText,
  extractTaskChildTitles,
  groupTaskContextMatches,
  normalizeAgentSearchText,
  normalizeFinanceDecimal,
  resolveFinanceToolResultAnswer,
  sumFinanceAmounts,
  scoreAgentText,
  selectDiverseAgentFragments,
  resolveTaskChildDocuments,
} from './chatScopedAgentRuntime'

describe('chatScopedAgentRuntime', () => {
  it('removes global agent knowledge tools from published Task Manager sessions', () => {
    const names = buildChatAgentTools('task-manager', false, true).map((tool) => tool.function.name)
    expect(names).toContain('change_task_state')
    expect(names).toContain('read_all_task_tickets')
    expect(names).not.toContain('add_agent_rule')
    expect(names).not.toContain('add_agent_memory')
  })

  it('instructs the Telegram library agent to reuse search results', () => {
    const prompt = buildChatAgentSystemPrompt('library', 'Base')
    expect(prompt).toContain('no repitas una busqueda ni una lectura')
    expect(prompt).toContain('personas, tareas o tickets')
    expect(prompt).toContain('usa add_task_comment')
    expect(prompt).toContain('Nunca uses replace_library_document para simular un comentario')
    expect(prompt).toContain('nunca atribuyas una tarea, responsable, estado, fecha o compromiso')
    expect(prompt).toContain('lee el documento completo antes de responder')
    expect(buildChatAgentTools('library').map((tool) => tool.function.name)).toContain('add_task_comment')
  })
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

  it('resolves linked subtasks only inside the parent ticket board', () => {
    const parent = {
      id: 'doc-1',
      option: {
        path: 'C:/vault/task-mannager/default/Parent.md',
        name: 'Parent.md',
        relativePath: 'task-mannager/default/Parent.md',
      },
    }
    const expectedChild = {
      id: 'doc-2',
      option: {
        path: 'C:/vault/task-mannager/default/subTasks/Seguimiento.md',
        name: 'Seguimiento.md',
        relativePath: 'task-mannager/default/subTasks/Seguimiento.md',
      },
    }
    const otherBoardChild = {
      id: 'doc-3',
      option: {
        path: 'C:/vault/task-mannager/otro/subTasks/Seguimiento.md',
        name: 'Seguimiento.md',
        relativePath: 'task-mannager/otro/subTasks/Seguimiento.md',
      },
    }
    const content = [
      '---',
      'childs: ["[[Seguimiento]]"]',
      '---',
      '',
      'Detalle del ticket padre.',
    ].join('\n')

    expect(extractTaskChildTitles(content)).toEqual(['Seguimiento'])
    expect(resolveTaskChildDocuments(parent, content, [parent, expectedChild, otherBoardChild]))
      .toEqual([expectedChild])
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

  it('exposes the same complete native-tool catalog in every chat scope', () => {
    const names = buildChatAgentTools('task-manager').map((tool) => tool.function.name)
    expect(buildChatAgentTools('library').map((tool) => tool.function.name)).toEqual(names)
    expect(buildChatAgentTools('graph').map((tool) => tool.function.name)).toEqual(names)
    expect(buildChatAgentTools('document').map((tool) => tool.function.name)).toEqual(names)
    expect(names).toContain('search_task_context')
    expect(names).toContain('read_task_tickets')
    expect(names).toContain('read_all_task_tickets')
    expect(names).toContain('get_task_manager_options')
    expect(names).toContain('set_task_execution_plan')
    expect(names).toContain('search_library_context')
    expect(names).toContain('request_file_read_permission')
    expect(names).toContain('create_library_note')
    expect(names).toContain('replace_library_document')
    expect(names).toContain('delete_library_document')
    expect(names).toEqual(expect.arrayContaining([
      'create_task_ticket',
      'replace_task_content',
      'add_task_comment',
      'add_task_subtask',
      'move_task_group',
      'change_task_state',
      'change_task_priority',
      'create_task_group',
      'delete_task_group',
    ]))
    const mutationNames = [
      'create_task_ticket', 'replace_task_content', 'add_task_comment', 'add_task_subtask',
      'move_task_group', 'change_task_state', 'change_task_priority', 'create_task_group',
      'delete_task_group', 'create_library_note', 'replace_library_document', 'delete_library_document',
    ]
    const mutationTools = buildChatAgentTools('task-manager')
      .filter((tool) => mutationNames.includes(tool.function.name))
    expect(mutationTools).toHaveLength(12)
    expect(mutationTools.every((tool) => tool.function.description.includes('confirmacion'))).toBe(true)
  })

  it('keeps finance on the common chat facade with typed tools and no library context', () => {
    const financeTools = buildChatAgentTools('finance')
    const names = financeTools.map((tool) => tool.function.name)
    expect(names).toEqual(expect.arrayContaining([
      'get_finance_dashboard',
      'create_finance_transaction',
      'update_finance_transaction_status',
      'search_finance_categories',
      'create_finance_category',
      'create_finance_purchase',
      'create_finance_salary',
      'create_finance_credit_card_statement',
      'list_finance_salaries',
      'list_finance_credit_card_statements',
      'list_finance_purchases',
    ]))
    expect(names).not.toContain('add_agent_rule')
    expect(names).not.toContain('add_agent_memory')
    expect(names).not.toContain('create_library_note')
    expect(names).not.toContain('create_task_ticket')
    const prompt = buildChatAgentSystemPrompt('finance', 'Base')
    expect(prompt).toContain('herramientas financieras')
    expect(prompt).toContain('no indicó una cuenta inequívoca')
    expect(prompt).toContain('Orden obligatorio')
    expect(prompt).toContain('create_finance_category')
    const createTransaction = financeTools.find((tool) => tool.function.name === 'create_finance_transaction')
    expect(createTransaction?.function.description).toContain('Nunca pidas una confirmacion en texto')
    expect(createTransaction?.function.parameters).toMatchObject({
      properties: {
        accountId: { description: expect.stringContaining('list_finance_accounts') },
        confidence: { description: expect.stringContaining('0.95') },
      },
    })
    const updateTransaction = financeTools.find((tool) => tool.function.name === 'update_finance_transaction_status')
    expect(updateTransaction?.function.description).toContain('list_finance_movements')
    const createCategory = financeTools.find((tool) => tool.function.name === 'create_finance_category')
    expect(createCategory?.function.description).toContain('confirmacion visible')
    const createPurchase = financeTools.find((tool) => tool.function.name === 'create_finance_purchase')
    expect(createPurchase?.function.description).toContain('observaciones historicas de precio')
    const createSalary = financeTools.find((tool) => tool.function.name === 'create_finance_salary')
    expect(createSalary?.function.description).toContain('ingreso por el neto')
    expect(createSalary?.function.parameters).toMatchObject({
      required: expect.arrayContaining(['accountId', 'period', 'paymentDate', 'employer', 'grossAmount', 'deductionsTotal', 'netAmount', 'currency', 'concepts']),
    })
    const createStatement = financeTools.find((tool) => tool.function.name === 'create_finance_credit_card_statement')
    expect(createStatement?.function.description).toContain('total a pagar')
    expect(createStatement?.function.parameters).toMatchObject({
      required: expect.arrayContaining(['accountId', 'issuer', 'period', 'closingDate', 'dueDate', 'currency', 'totalDue', 'items']),
    })
  })

  it('configures Telegram finance tools to create categories and confirm purchases automatically', () => {
    const financeTools = buildChatAgentTools('finance', true)
    expect(financeTools.find((tool) => tool.function.name === 'create_finance_category')?.function.description).toContain('automáticamente')
    expect(financeTools.find((tool) => tool.function.name === 'create_finance_purchase')?.function.description).toContain('automáticamente')
    expect(financeTools.find((tool) => tool.function.name === 'create_finance_salary')?.function.description).toContain('automáticamente')
    expect(financeTools.find((tool) => tool.function.name === 'create_finance_credit_card_statement')?.function.description).toContain('automáticamente')
    expect(financeTools.find((tool) => tool.function.name === 'create_finance_purchase')?.function.parameters)
      .toMatchObject({ required: expect.arrayContaining(['categoryId']) })
    expect(buildChatAgentSystemPrompt('finance', 'Base', null, 'telegram-html')).toContain('registra y confirma la operación de inmediato')
    expect(buildChatAgentSystemPrompt('finance', 'Base', null, 'telegram-html')).toContain('no finalices con un resumen')
    expect(buildChatAgentSystemPrompt('finance', 'Base', null, 'telegram-html')).toContain('create_finance_salary')
    expect(buildChatAgentSystemPrompt('finance', 'Base', null, 'telegram-html')).toContain('create_finance_credit_card_statement')
  })

  it('normalizes model-emitted finance amounts without repeated correction rounds', () => {
    expect(normalizeFinanceDecimal(48000)).toBe('48000')
    expect(normalizeFinanceDecimal('$ 48.000,00')).toBe('48000')
    expect(normalizeFinanceDecimal('48,000.50')).toBe('48000.5')
    expect(normalizeFinanceDecimal('1,000', 6)).toBe('1')
    expect(normalizeFinanceDecimal('-10')).toBeNull()
    expect(normalizeFinanceDecimal('cuarenta')).toBeNull()
    expect(sumFinanceAmounts(['12000', '36.000,00'])).toBe('48000')
  })

  it('turns a ticket purchase result into a terminal factual answer', () => {
    const call = {
      function: {
        name: 'create_finance_purchase',
        arguments: {
          merchantName: 'Shamishawarma', totalAmount: '48000', currency: 'ARS',
          accountId: 'Digital', categoryId: 'Comida', observedAt: '2026-08-30T13:44:00',
          items: [{ originalDescription: 'Cena Sharmi' }],
        },
      },
    }

    expect(resolveFinanceToolResultAnswer(call, { ok: true, changed: true, purchase: {} }))
      .toContain('Registré el ticket de Shamishawarma')
    expect(resolveFinanceToolResultAnswer(call, { ok: true, changed: false, duplicate: true }))
      .toContain('ya estaba registrado')
    expect(resolveFinanceToolResultAnswer(call, {
      ok: false, error: 'finance-purchase-save-failed', code: 'validation', message: 'La suma de líneas no coincide.',
    })).toContain('los importes no son coherentes')
    expect(resolveFinanceToolResultAnswer(call, {
      ok: false, error: 'finance-purchase-save-failed', code: 'storage', message: 'internal database detail',
    })).not.toContain('internal database detail')
  })

  it('turns a salary receipt result into a terminal factual answer', () => {
    const call = {
      function: {
        name: 'create_finance_salary',
        arguments: {
          employer: 'Empresa SA', period: '2026-08', paymentDate: '2026-08-31',
          grossAmount: '1200000', deductionsTotal: '200000', netAmount: '1000000',
          currency: 'ARS', accountId: 'Digital',
          concepts: [{ name: 'Sueldo básico', conceptType: 'earning', amount: '1200000' }],
        },
      },
    }

    expect(resolveFinanceToolResultAnswer(call, { ok: true, changed: true, salary: {}, accountName: 'Digital' }))
      .toContain('Registré el recibo de sueldo de Empresa SA')
    expect(resolveFinanceToolResultAnswer(call, { ok: true, changed: false, duplicate: true }))
      .toContain('ya estaba registrado')
    expect(resolveFinanceToolResultAnswer(call, {
      ok: false, error: 'finance-salary-save-failed', code: 'validation', message: 'El neto no coincide.',
    })).toContain('no son coherentes')
    expect(resolveFinanceToolResultAnswer(call, {
      ok: false, error: 'finance-salary-save-failed', code: 'storage', message: 'internal database detail',
    })).not.toContain('internal database detail')
  })

  it('turns a credit-card statement result into a terminal factual answer', () => {
    const call = {
      function: {
        name: 'create_finance_credit_card_statement',
        arguments: { issuer: 'Banco Notia', period: '2026-08', dueDate: '2026-09-08', totalDue: '2250', currency: 'ARS', accountId: 'Visa' },
      },
    }
    expect(resolveFinanceToolResultAnswer(call, { ok: true, changed: true, accountName: 'Visa', createdTransactions: 4, matchedExistingTransactions: 2 }))
      .toContain('Registré el resumen de tarjeta de Banco Notia')
    expect(resolveFinanceToolResultAnswer(call, { ok: true, changed: false, duplicate: true })).toContain('ya estaba registrado')
    expect(resolveFinanceToolResultAnswer(call, { ok: false, error: 'finance-credit-card-statement-save-failed', code: 'validation', message: 'El total no coincide.' }))
      .toContain('no son coherentes')
    expect(resolveFinanceToolResultAnswer(call, { ok: false, error: 'finance-credit-card-statement-save-failed', code: 'storage', message: 'database detail' }))
      .not.toContain('database detail')
  })

  it('rejects a financial success claim when no mutation actually ran', () => {
    expect(validateFinanceFinalAnswer('Listo, registré el gasto de 4000.', false)).toContain('ninguna mutación financiera se ejecutó')
    expect(validateFinanceFinalAnswer('Ahora voy a registrar el gasto de 4000.', false)).toContain('ninguna mutación financiera se ejecutó')
    expect(validateFinanceFinalAnswer('Necesito saber en qué cuenta cargarlo.', false)).toContain('request_user_clarification')
    expect(validateFinanceFinalAnswer('Necesito saber en qué cuenta cargarlo.', false, true)).toBeNull()
    expect(validateFinanceFinalAnswer('Listo, registré el gasto.', true)).toBeNull()
    expect(validateFinanceFinalAnswer('Ticket de compra detectado\nComercio: Shell', false, false, true, false)).toContain('create_finance_purchase')
    expect(validateFinanceFinalAnswer('Ticket de compra detectado', true, false, true, false)).toContain('create_finance_purchase')
    expect(validateFinanceFinalAnswer('Ticket de compra detectado', true, false, true, true)).toBeNull()
    expect(validateFinanceFinalAnswer('Recibo de sueldo detectado', false, false, true, false, false)).toContain('create_finance_salary')
    expect(validateFinanceFinalAnswer('Recibo de sueldo detectado', true, false, true, false, true)).toBeNull()
    expect(validateFinanceFinalAnswer('Resumen de tarjeta de crédito detectado', false, false, true, false, false, false)).toContain('create_finance_credit_card_statement')
    expect(validateFinanceFinalAnswer('Resumen de tarjeta de crédito detectado', true, false, true, false, false, true)).toBeNull()
  })

  it('includes file permission in the shared catalog and enforces it through document context', () => {
    const names = buildChatAgentTools('document').map((tool) => tool.function.name)
    expect(names).toContain('request_file_read_permission')
    expect(buildChatAgentSystemPrompt('document')).toContain('Solo el archivo activo esta autorizado')
  })

  it('identifies the active file without embedding its contents', () => {
    const prompt = buildChatAgentSystemPrompt('document', 'Base', 'C:/vault/Nota.md')

    expect(prompt).toContain('Archivo activo (solo identidad; su contenido no fue incluido): C:/vault/Nota.md')
  })

  it('instructs Task Manager to use RAG before full reads', () => {
    const prompt = buildChatAgentSystemPrompt('task-manager')
    expect(prompt).toContain('usa primero search_task_context')
    expect(prompt).toContain('debes llamar read_all_task_tickets')
    expect(prompt).toContain('nunca sirve para afirmar que encontraste todos')
    expect(prompt).toContain('read_task_tickets solo si')
    expect(prompt).toContain('incluyen automaticamente cada subtarea enlazada y su contenido')
    expect(prompt).toContain('Antes de cada mutacion')
    expect(prompt).toContain('una confirmacion previa no autoriza operaciones posteriores')
    expect(prompt).toContain('Politica de no invencion')
    expect(prompt).toContain('No confundas aclaracion con autorizacion')
    expect(prompt).toContain('No agrupes varias escrituras bajo una confirmacion')
    expect(prompt).toContain('No uses el primer resultado por conveniencia')
    expect(prompt).toContain('incluyendo cada alternativa concreta en choices')
    expect(prompt).toContain('crear uno con create_task_group')
    expect(prompt).toContain('no tiene ningun ticket asignado')
    expect(prompt).toContain('antes de la primera mutacion llama set_task_execution_plan')
    expect(prompt).toContain('planStepId')
    expect(prompt).toContain('requiere aprobacion explicita')
    expect(prompt).toContain('presenta un nuevo plan para aprobar')
    expect(prompt).toContain('cada mutacion debe solicitarse sola')
    expect(prompt).toContain('Un check del TO-DO equivale a una unica mutacion')
    expect(prompt).toContain('incluyendo todos sus titulos en titles')
    expect(prompt).toContain('botones clickeables dentro del chat')
    expect(prompt).toContain('No hagas una pregunta generica')
    expect(prompt).toContain('Si el usuario rechaza una confirmacion, no reintentes')
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

  it('reserva el formato HTML compatible con Telegram para ese canal', () => {
    const telegramPrompt = buildChatAgentSystemPrompt('library', 'Base', null, 'telegram-html')
    const regularPrompt = buildChatAgentSystemPrompt('library', 'Base')

    expect(telegramPrompt).toContain('No uses Markdown ni sus marcadores')
    expect(telegramPrompt).toContain('HTML compatible con Telegram')
    expect(regularPrompt).not.toContain('HTML compatible con Telegram')
  })

  it('instructs Graph View to resolve named folders by path', () => {
    const prompt = buildChatAgentSystemPrompt('graph')
    expect(prompt).toContain('rutas o carpetas nombradas')
    expect(prompt).toContain('cuya ruta esta dentro de esa carpeta')
  })
})
