// @vitest-environment happy-dom
import { createRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

vi.mock('../../../../store/hooks', () => ({ useAppSelector: () => ({ pauseDetectionMs: 900 }) }))
vi.mock('../../../../services/qwen3Tts/qwen3TtsRuntime', () => ({
  playConversationReadyCue: vi.fn(),
  speakWithQwen3Tts: vi.fn(),
  stopQwen3TtsSpeech: vi.fn(),
}))
vi.mock('./useVoiceTranscription', () => ({
  useVoiceTranscription: () => ({
    state: { status: 'idle' },
    isActive: false,
    isModelReady: false,
    start: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    stop: vi.fn(),
    cancel: vi.fn(),
    dismissError: vi.fn(),
  }),
}))

const { ChatComposer } = await import('./ChatComposer')

type ComposerProps = Parameters<typeof ChatComposer>[0]

function renderComposer(overrides: Partial<ComposerProps>) {
  const props: ComposerProps = {
    draft: '',
    setDraft: vi.fn(),
    canSubmit: false,
    isSubmitting: false,
    isAiAvailable: true,
    library: { id: 'lib', name: 'gaia', path: 'C:/lib' },
    activeModelLabel: 'qwen',
    selectedImageAttachments: [],
    selectedLibraryFileSummary: [],
    selectedLibraryFilePaths: [],
    effectiveSelectedContextPaths: [],
    effectiveSelectedContextMode: 'full',
    transientContextSummaryLabel: null,
    transientContextDisplayPaths: [],
    hasTransientContext: false,
    isAttachmentMenuOpen: false,
    attachmentMenuPosition: null,
    onRemoveImage: vi.fn(),
    onRemoveFile: vi.fn(),
    onToggleAttachmentMenu: vi.fn(),
    onSelectImage: vi.fn(),
    onOpenLibraryFilesModal: vi.fn(),
    onSubmit: vi.fn(),
    onSubmitText: vi.fn(),
    lastAssistantMessage: null,
    onCancel: vi.fn(),
    triggerRef: createRef<HTMLButtonElement>(),
    panelRef: createRef<HTMLDivElement>(),
    imageInputRef: createRef<HTMLInputElement>(),
    ...overrides,
  } as ComposerProps
  render(<ChatComposer {...props} />)
  return props
}

describe('ChatComposer while a turn runs', () => {
  afterEach(cleanup)

  it('keeps the stop button and shows the send button once there is text', () => {
    renderComposer({ isSubmitting: true })
    expect(screen.getByRole('button', { name: 'Detener respuesta' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Enviar mensaje' })).toBeNull()
    cleanup()

    const props = renderComposer({ isSubmitting: true, draft: 'cancelá', canSubmit: true })
    expect(screen.getByRole('button', { name: 'Detener respuesta' })).toBeTruthy()
    const send = screen.getByRole('button', { name: 'Enviar mensaje' }) as HTMLButtonElement
    expect(send.title).toContain('lo deja en cola')
    fireEvent.click(send)
    expect(props.onSubmit).toHaveBeenCalledTimes(1)
    expect(props.onCancel).not.toHaveBeenCalled()
  })

  it('lists the queued messages and removes one', () => {
    const onRemoveQueuedMessage = vi.fn()
    renderComposer({
      isSubmitting: true,
      queuedMessages: [
        { id: 'a', text: 'creá una nota con el resumen', deciding: false },
        { id: 'b', text: 'y mandala por mail', deciding: true },
      ],
      onRemoveQueuedMessage,
    })
    const queue = screen.getByRole('list', { name: 'Mensajes en cola' })
    expect(queue.textContent).toContain('creá una nota con el resumen')
    expect(queue.textContent).toContain('En cola')
    expect(queue.textContent).toContain('Decidiendo…')
    fireEvent.click(screen.getByRole('button', { name: 'Quitar de la cola: y mandala por mail' }))
    expect(onRemoveQueuedMessage).toHaveBeenCalledWith('b')
  })
})
