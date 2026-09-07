import { describe, expect, it } from 'vitest'
import {
  buildTelegramProgressMessage,
  createTelegramProgressState,
  reduceTelegramProgress,
  shouldPublishTelegramProgress,
  telegramToolLabel,
} from './telegramProgressRuntime'

describe('telegram progress runtime', () => {
  it('renders safe, human-readable labels instead of internal tool names', () => {
    const state = reduceTelegramProgress(
      createTelegramProgressState(),
      { type: 'tool-started', round: 1, toolName: 'read_active_markdown_document' },
    )

    expect(buildTelegramProgressMessage(state)).toContain('leyendo el documento activo')
    expect(buildTelegramProgressMessage(state)).not.toContain('read_active_markdown_document')
    expect(telegramToolLabel('compare_documents')).toBe('comparando documentos autorizados')
    expect(telegramToolLabel('link_ticket_document')).toBe('vinculando el ticket con el documento')
    expect(telegramToolLabel('extract_document_facts')).toBe('extrayendo datos explícitos del documento')
    expect(telegramToolLabel('unknown_tool_with_private_argument')).toBe('ejecutando una operación autorizada')
  })

  it('keeps clarification and confirmation as explicit waiting states', () => {
    const clarification = reduceTelegramProgress(createTelegramProgressState(), {
      type: 'clarification-required', clarificationId: 'private-id',
    })
    const confirmation = reduceTelegramProgress(createTelegramProgressState(), {
      type: 'confirmation-required', operationId: 'private-id',
    })

    expect(buildTelegramProgressMessage(clarification)).toContain('Necesito una aclaración')
    expect(buildTelegramProgressMessage(confirmation)).toContain('Espero tu confirmación')
    expect(buildTelegramProgressMessage(confirmation)).not.toContain('private-id')
  })

  it('shows safe multimodal stages for audio and attachments', () => {
    const state = reduceTelegramProgress(createTelegramProgressState(), {
      type: 'multimodal-stage',
      stage: 'extracting',
    })

    expect(state.phase).toBe('reading')
    expect(buildTelegramProgressMessage(state, { progressMode: 'detailed' })).toContain('Extrayendo el contenido del archivo.')

    const context = reduceTelegramProgress(state, {
      type: 'multimodal-stage',
      stage: 'building-context',
    })
    expect(context.phase).toBe('preparing')
    expect(buildTelegramProgressMessage(context, { progressMode: 'detailed' })).not.toContain('private')
  })

  it('renders plan progress by step without exposing model labels or internal ids', () => {
    const planned = reduceTelegramProgress(createTelegramProgressState(), {
      type: 'plan-created',
      plan: {
        id: 'plan-private',
        title: 'Plan privado',
        status: 'in-progress',
        requiresApproval: true,
        approved: true,
        steps: [
          {
            id: 'step-private', label: 'C:/private/cliente.md', description: 'privado', dependsOn: [],
            status: 'pending', plannedToolName: 'replace_active_markdown_document', risk: 'medium',
            canRetry: false, operationId: null, resultSummary: null, error: null,
          },
          {
            id: 'step-2', label: 'Aplicar', description: '', dependsOn: [], status: 'pending',
            plannedToolName: null, risk: 'low', canRetry: true, operationId: null, resultSummary: null, error: null,
          },
        ],
      },
    })
    const message = buildTelegramProgressMessage(planned)

    expect(message).toContain('TO-DO (2 pasos)')
    expect(message).toContain('Paso 1: pendiente')
    expect(message).toContain('preparando una mejora del documento')
    expect(message).not.toContain('C:/private/cliente.md')
    expect(message).not.toContain('step-private')

    const running = reduceTelegramProgress(planned, {
      type: 'step-started', planStepId: 'step-private', label: 'C:/private/cliente.md',
    })
    expect(buildTelegramProgressMessage(running)).toContain('Paso 1: en curso')

    const completed = reduceTelegramProgress(running, {
      type: 'step-completed', planStepId: 'step-private', status: 'completed',
    })
    expect(buildTelegramProgressMessage(completed)).toContain('Paso 1: completado')
  })

  it('publishes immediately for critical events and throttles intermediate updates', () => {
    expect(shouldPublishTelegramProgress(null, 100, false)).toBe(true)
    expect(shouldPublishTelegramProgress(100, 1_000, false)).toBe(false)
    expect(shouldPublishTelegramProgress(100, 2_100, false)).toBe(true)
    expect(shouldPublishTelegramProgress(100, 200, true)).toBe(true)
  })

  it('ignores late or cross-request events', () => {
    const current = reduceTelegramProgress(createTelegramProgressState(), {
      requestId: 'request-1', timestamp: 200, type: 'phase-changed', phase: 'reading', round: 1,
    })
    const late = reduceTelegramProgress(current, {
      requestId: 'request-1', timestamp: 100, type: 'phase-changed', phase: 'failed', round: 1,
    })
    const other = reduceTelegramProgress(current, {
      requestId: 'request-2', timestamp: 300, type: 'completed', rounds: 1,
    })

    expect(late.phase).toBe('reading')
    expect(other.phase).toBe('reading')
    expect(other.requestId).toBe('request-1')
  })
})
