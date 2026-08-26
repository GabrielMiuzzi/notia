import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { ArrowUp, FileImage, Files, Info, Mic, Pause, Phone, PhoneOff, Play, Plus, Square, X } from 'lucide-react'
import { NotiaButton } from '../../../common/NotiaButton'
import { NotiaSubmenuPanel } from '../../NotiaSubmenuPanel'
import { buildAttachmentDisplayName } from '../../../../services/chat/chatAttachmentRuntime'
import type { ChatFileContextMode, ChatLibraryFileOption } from '../../../../services/chat/chatAttachmentRuntime'
import type { SelectedImageAttachment, AttachmentMenuPosition } from './ChatWorkspaceViewTypes'
import { useVoiceTranscription } from './useVoiceTranscription'
import { useAppSelector } from '../../../../store/hooks'
import { selectQwen3TtsSettings } from '../../../../features/preferences/preferencesSelectors'
import { playConversationReadyCue, speakWithQwen3Tts, stopQwen3TtsSpeech } from '../../../../services/qwen3Tts/qwen3TtsRuntime'

interface ChatComposerProps {
  draft: string
  setDraft: (value: string) => void
  canSubmit: boolean
  isSubmitting: boolean
  awaitingAgentClarification?: boolean
  isAiAvailable: boolean
  library: import('../../../../types/notia').NotiaLibrary | null
  composerContextLabel?: string
  activeModelLabel: string
  selectedImageAttachment: SelectedImageAttachment | null
  selectedLibraryFileSummary: ChatLibraryFileOption[]
  selectedLibraryFilePaths: string[]
  effectiveSelectedContextPaths: string[]
  effectiveSelectedContextMode: ChatFileContextMode
  transientContextSummaryLabel: string | null
  transientContextDisplayPaths: string[]
  hasTransientContext: boolean
  isAttachmentMenuOpen: boolean
  attachmentMenuPosition: AttachmentMenuPosition | null
  onRemoveImage: () => void
  onRemoveFile: (path: string) => void
  onTransientContextPathRemove?: (path: string) => void
  onToggleAttachmentMenu: () => void
  onSelectImage: () => void
  onOpenLibraryFilesModal: () => void
  onSubmit: () => void
  onSubmitText: (text: string) => void | Promise<void>
  lastAssistantMessage: string | null
  onCancel?: () => void
  triggerRef: React.RefObject<HTMLButtonElement | null>
  panelRef: React.RefObject<HTMLDivElement | null>
  imageInputRef: React.RefObject<HTMLInputElement | null>
}

function ChatComposerComponent({
  draft,
  setDraft,
  canSubmit,
  isSubmitting,
  awaitingAgentClarification = false,
  isAiAvailable,
  library,
  composerContextLabel,
  activeModelLabel,
  selectedImageAttachment,
  selectedLibraryFileSummary,
  selectedLibraryFilePaths,
  effectiveSelectedContextPaths,
  effectiveSelectedContextMode,
  transientContextSummaryLabel,
  transientContextDisplayPaths,
  hasTransientContext,
  isAttachmentMenuOpen,
  attachmentMenuPosition,
  onRemoveImage,
  onRemoveFile,
  onTransientContextPathRemove,
  onToggleAttachmentMenu,
  onSelectImage,
  onOpenLibraryFilesModal,
  onSubmit,
  onSubmitText,
  lastAssistantMessage,
  onCancel,
  triggerRef,
  panelRef,
  imageInputRef,
}: ChatComposerProps) {
  const qwen3Tts = useAppSelector(selectQwen3TtsSettings)
  const [isConversationMode, setIsConversationMode] = useState(false)
  const [conversationStatus, setConversationStatus] = useState('')
  const waitingForAssistantRef = useRef(false)
  const lastSpokenAssistantRef = useRef<string | null>(null)
  const voice = useVoiceTranscription({
    draft,
    setDraft,
    pauseDetectionMs: isConversationMode ? qwen3Tts.pauseDetectionMs : null,
    continuousSession: isConversationMode,
    onCompleted: (text) => {
      const spokenText = text.trim()
      if (!isConversationMode || !spokenText) return
      waitingForAssistantRef.current = true
      setConversationStatus('Pensando...')
      setDraft('')
      void Promise.resolve(onSubmitText(spokenText)).catch((error) => {
        waitingForAssistantRef.current = false
        setConversationStatus(error instanceof Error ? error.message : 'No se pudo enviar el mensaje hablado.')
      })
    },
  })
  const stopConversation = useCallback(() => {
    setIsConversationMode(false)
    waitingForAssistantRef.current = false
    setConversationStatus('')
    stopQwen3TtsSpeech()
    void voice.cancel()
  }, [voice])

  useEffect(() => {
    if (!isConversationMode || !waitingForAssistantRef.current || !lastAssistantMessage || lastSpokenAssistantRef.current === lastAssistantMessage) return
    waitingForAssistantRef.current = false
    lastSpokenAssistantRef.current = lastAssistantMessage
    setConversationStatus('Respondiendo...')
    void speakWithQwen3Tts(lastAssistantMessage, qwen3Tts)
      .then(async () => {
        setConversationStatus('Preparando micrófono...')
        const resumedExistingSession = await voice.resume()
        if (!resumedExistingSession && !await voice.start()) throw new Error('No se pudo preparar el micrófono.')
        await playConversationReadyCue()
        setConversationStatus('Escuchando...')
      })
      .catch((error) => { setConversationStatus(error instanceof Error ? error.message : 'Falló la voz.'); setIsConversationMode(false) })
  }, [isConversationMode, lastAssistantMessage, qwen3Tts, voice])

  const startConversation = useCallback(() => {
    if (!qwen3Tts.enabled) {
      setConversationStatus('Activa Qwen3-TTS 0.6B en Configuraciones → Voz.')
      return
    }
    setIsConversationMode(true)
    lastSpokenAssistantRef.current = lastAssistantMessage
    setConversationStatus('Iniciando llamada...')
    void speakWithQwen3Tts(qwen3Tts.greeting, qwen3Tts)
      .then(async () => {
        setConversationStatus('Preparando micrófono...')
        if (!await voice.start()) throw new Error('No se pudo preparar el micrófono.')
        await playConversationReadyCue()
        setConversationStatus('Escuchando...')
      })
      .catch((error) => { setConversationStatus(error instanceof Error ? error.message : 'No se pudo iniciar la llamada.'); setIsConversationMode(false) })
  }, [lastAssistantMessage, qwen3Tts, voice])
  const hasAnyAttachment = selectedImageAttachment
    || selectedLibraryFileSummary.length > 0
    || transientContextSummaryLabel
    || effectiveSelectedContextPaths.length > 0

  return (
    <form
      className="notia-chat-composer"
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit()
      }}
    >
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        className="notia-chat-image-input"
        onChange={(event) => {
          const inputElement = event.currentTarget
          const nextFile = event.target.files?.[0] ?? null
          if (!nextFile) {
            return
          }

          const { onImageSelected } = window as unknown as {
            onImageSelected?: (file: File) => Promise<void>
          }
          void onImageSelected?.(nextFile).finally(() => {
            inputElement.value = ''
          })
        }}
      />
      {composerContextLabel ? (
        <div className="notia-chat-context-indicator" aria-live="polite">
          <Info size={14} />
          <span>{composerContextLabel}</span>
        </div>
      ) : null}
      {hasAnyAttachment ? (
        <div
          className="notia-chat-attachments"
          role="region"
          aria-label="Archivos adjuntos"
          tabIndex={0}
        >
          {selectedImageAttachment ? (
            <div className="notia-chat-attachment-pill">
              <FileImage size={14} />
              <span>{selectedImageAttachment.name}</span>
              <button
                type="button"
                aria-label="Quitar imagen"
                onClick={onRemoveImage}
              >
                <X size={12} />
              </button>
            </div>
          ) : null}
          {transientContextSummaryLabel ? (
            <div className="notia-chat-attachment-pill">
              <Files size={14} />
              <span>{transientContextSummaryLabel}</span>
            </div>
          ) : null}
          {hasTransientContext ? transientContextDisplayPaths.map((path) => {
            const displayName = buildAttachmentDisplayName(path)
            return (
              <div key={path} className="notia-chat-attachment-pill">
                <Files size={14} />
                <span>{displayName}</span>
                {onTransientContextPathRemove ? (
                  <button
                    type="button"
                    aria-label={`Quitar ${displayName} del contexto`}
                    onClick={() => onTransientContextPathRemove(path)}
                  >
                    <X size={12} />
                  </button>
                ) : null}
              </div>
            )
          }) : null}
          {!hasTransientContext ? selectedLibraryFileSummary.map((fileOption) => (
            <div key={fileOption.path} className="notia-chat-attachment-pill">
              <Files size={14} />
              <span>{fileOption.name}</span>
              <button
                type="button"
                aria-label={`Quitar ${fileOption.name}`}
                onClick={() => {
                  onRemoveFile(fileOption.path)
                }}
              >
                <X size={12} />
              </button>
            </div>
          )) : null}
          {!hasTransientContext ? selectedLibraryFilePaths
            .filter((path) => !selectedLibraryFileSummary.some((option) => option.path === path))
            .map((path) => (
              <div key={path} className="notia-chat-attachment-pill">
                <Files size={14} />
                <span>{buildAttachmentDisplayName(path)}</span>
                <button
                  type="button"
                  aria-label={`Quitar ${buildAttachmentDisplayName(path)}`}
                  onClick={() => {
                    onRemoveFile(path)
                  }}
                >
                  <X size={12} />
                </button>
              </div>
            )) : null}
          {effectiveSelectedContextPaths.length > 0 ? (
            <div
              className="notia-chat-attachment-mode-badge"
              title={
                effectiveSelectedContextMode === 'index'
                  ? 'Referencia: la IA conoce nombres y rutas de los archivos, no su contenido.'
                  : 'Directo: se envía el contenido completo de los archivos.'
              }
              aria-label={
                effectiveSelectedContextMode === 'index'
                  ? 'Modo referencia: la IA conoce nombres y rutas de los archivos, no su contenido.'
                  : 'Modo directo: se envía el contenido completo de los archivos.'
              }
              role="status"
            >
              {effectiveSelectedContextMode === 'index' ? 'Referencia' : 'Directo'}
            </div>
          ) : null}
        </div>
      ) : null}
      <label className="notia-chat-composer-field" aria-label="Escribir mensaje">
        <textarea
          value={draft}
          rows={1}
          placeholder={awaitingAgentClarification
            ? 'Escribí la aclaración para que el agente continúe...'
            : library ? 'Escribi tu mensaje...' : 'Primero elegí una librería activa...'}
          disabled={!library}
          readOnly={voice.isActive}
          onChange={(event) => {
            setDraft(event.target.value)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              onSubmit()
            }
          }}
        />
      </label>
      {voice.state.status !== 'idle' ? (
        <div
          className={`notia-chat-voice-status notia-chat-voice-status--${voice.state.status}`}
          role={voice.state.status === 'error' ? 'alert' : 'status'}
          aria-live="polite"
        >
          <span>{describeVoiceState(voice.state)}</span>
          {voice.isActive ? (
            <div className="notia-chat-voice-controls" role="group" aria-label="Controles de dictado">
              {voice.state.status === 'recording' ? (
                <NotiaButton type="button" size="icon" variant="secondary" title="Pausar dictado" aria-label="Pausar dictado" onClick={voice.pause}>
                  <Pause size={16} />
                </NotiaButton>
              ) : voice.state.status === 'paused' ? (
                <NotiaButton type="button" size="icon" variant="secondary" title="Reanudar dictado" aria-label="Reanudar dictado" onClick={voice.resume}>
                  <Play size={16} />
                </NotiaButton>
              ) : null}
              <NotiaButton type="button" size="icon" variant="primary" title="Finalizar dictado" aria-label="Finalizar dictado" onClick={voice.stop} disabled={voice.state.status === 'finalizing'}>
                <Square size={15} />
              </NotiaButton>
              <NotiaButton type="button" size="icon" variant="secondary" title="Cancelar dictado" aria-label="Cancelar dictado" onClick={voice.cancel}>
                <X size={16} />
              </NotiaButton>
            </div>
          ) : voice.state.status === 'error' || voice.state.status === 'completed' ? (
            <NotiaButton type="button" variant="secondary" onClick={voice.dismissError}>Cerrar</NotiaButton>
          ) : null}
        </div>
      ) : null}
      {conversationStatus ? <div className="notia-chat-voice-status" role="status" aria-live="polite">{conversationStatus}</div> : null}
      <div className="notia-chat-composer-footer">
        <span>{activeModelLabel} · Enter para enviar. Shift + Enter para salto de linea.</span>
        <div className="notia-chat-composer-actions">
          <NotiaButton
            type="button"
            size="icon"
            variant="secondary"
            title="Dictar mensaje sin conexion"
            aria-label="Iniciar dictado por microfono"
            onClick={voice.start}
            disabled={!library || voice.isActive}
          >
            <Mic size={16} />
          </NotiaButton>
          <NotiaButton type="button" size="icon" variant={isConversationMode ? 'primary' : 'secondary'}
            title={isConversationMode ? 'Finalizar modo charla' : 'Iniciar modo charla'}
            aria-label={isConversationMode ? 'Finalizar modo charla' : 'Iniciar modo charla'}
            onClick={isConversationMode ? stopConversation : startConversation}
            disabled={!library || (!isConversationMode && (voice.isActive || isSubmitting))}>
            {isConversationMode ? <PhoneOff size={16} /> : <Phone size={16} />}
          </NotiaButton>
          <div className="notia-chat-attachment-menu-shell">
            <NotiaButton
              ref={triggerRef}
              size="icon"
              variant="secondary"
              title="Adjuntar contexto"
              aria-label="Adjuntar contexto"
              onClick={onToggleAttachmentMenu}
              disabled={!library || isSubmitting || !isAiAvailable}
            >
              <Plus size={16} />
            </NotiaButton>
            {isAttachmentMenuOpen ? (
              <NotiaSubmenuPanel
                ref={panelRef}
                className="notia-chat-attachment-menu"
                style={attachmentMenuPosition
                  ? {
                    position: 'fixed',
                    top: `${attachmentMenuPosition.top}px`,
                    left: `${attachmentMenuPosition.left}px`,
                  }
                  : {
                    position: 'fixed',
                    top: '0',
                    left: '0',
                    visibility: 'hidden',
                  }}
              >
                <button
                  type="button"
                  className="notia-chat-attachment-menu-item"
                  onClick={onSelectImage}
                >
                  <FileImage size={15} />
                  <span>Seleccionar imagen</span>
                </button>
                <button
                  type="button"
                  className="notia-chat-attachment-menu-item"
                  onClick={onOpenLibraryFilesModal}
                >
                  <Files size={15} />
                  <span>Buscar archivos de la librería</span>
                </button>
              </NotiaSubmenuPanel>
            ) : null}
          </div>
          <NotiaButton type="submit" variant="primary" disabled={!canSubmit && !isSubmitting}>
            {awaitingAgentClarification ? 'Responder' : isSubmitting ? 'Enviando...' : 'Enviar'}
            <ArrowUp size={16} />
          </NotiaButton>
          {isSubmitting && onCancel ? (
            <NotiaButton
              type="button"
              variant="secondary"
              onClick={(event) => {
                event.preventDefault()
                onCancel()
              }}
            >
              Cancelar
            </NotiaButton>
          ) : null}
        </div>
      </div>
    </form>
  )
}

export const ChatComposer = memo(ChatComposerComponent)
ChatComposer.displayName = 'ChatComposer'

function describeVoiceState(state: ReturnType<typeof useVoiceTranscription>['state']): string {
  switch (state.status) {
    case 'preparing': return 'Preparando el dictado offline...'
    case 'recording': return `Escuchando · ${Math.floor(state.elapsedMs / 1_000)} s`
    case 'paused': return `Dictado pausado · ${Math.floor(state.elapsedMs / 1_000)} s`
    case 'finalizing': return 'Finalizando transcripcion y diarizacion...'
    case 'completed': return 'Transcripcion lista para revisar.'
    case 'error': return state.error.message
    case 'idle': return ''
  }
}
