import { memo } from 'react'
import { ArrowUp, FileImage, Files, Info, Plus, X } from 'lucide-react'
import { NotiaButton } from '../../../common/NotiaButton'
import { NotiaSubmenuPanel } from '../../NotiaSubmenuPanel'
import { buildAttachmentDisplayName } from '../../../../services/chat/chatAttachmentRuntime'
import type { ChatFileContextMode, ChatLibraryFileOption } from '../../../../services/chat/chatAttachmentRuntime'
import type { SelectedImageAttachment, AttachmentMenuPosition } from './ChatWorkspaceViewTypes'

interface ChatComposerProps {
  draft: string
  setDraft: (value: string) => void
  canSubmit: boolean
  isSubmitting: boolean
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
  hasTransientContext: boolean
  isAttachmentMenuOpen: boolean
  attachmentMenuPosition: AttachmentMenuPosition | null
  onRemoveImage: () => void
  onRemoveFile: (path: string) => void
  onToggleAttachmentMenu: () => void
  onSelectImage: () => void
  onOpenLibraryFilesModal: () => void
  onSubmit: () => void
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
  hasTransientContext,
  isAttachmentMenuOpen,
  attachmentMenuPosition,
  onRemoveImage,
  onRemoveFile,
  onToggleAttachmentMenu,
  onSelectImage,
  onOpenLibraryFilesModal,
  onSubmit,
  onCancel,
  triggerRef,
  panelRef,
  imageInputRef,
}: ChatComposerProps) {
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
          placeholder={library ? 'Escribi tu mensaje...' : 'Primero elegí una librería activa...'}
          disabled={!library || !isAiAvailable}
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
      <div className="notia-chat-composer-footer">
        <span>{activeModelLabel} · Enter para enviar. Shift + Enter para salto de linea.</span>
        <div className="notia-chat-composer-actions">
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
            {isSubmitting ? 'Enviando...' : 'Enviar'}
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
