import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Bot, Check, Circle, LoaderCircle, OctagonX, User2 } from 'lucide-react'
import { ChatMarkdownMessage } from './ChatMarkdownMessage'
import type { StoredChatMessage } from '../../../../services/chat/chatDocumentStorage'
import type { TaskExecutionStep } from '../../../../services/chat/chatScopedAgentRuntime'
import { telegramToolLabel } from '../../../../services/telegram/telegramProgressRuntime'
import type { MutationPreview } from '../../../../types/ai/agentContracts'
import type { AiOperationHistoryEntry } from '../../../../services/ai/aiOperationHistory'

interface ChatThreadProps {
  messages: StoredChatMessage[]
  isSubmitting: boolean
  isChatLoading: boolean
  isCheckingAiHealth: boolean
  aiAvailabilityMessage: string | null
  selectedChatFilePath: string | null
  showHistoryPanel: boolean
  streamingThinking: string
  streamingAssistantMessage: string
  pendingAgentQuestion?: { question: string; choices: string[] } | null
  pendingAgentAnswer?: string | null
  pendingAgentConfirmation?: string | null
  pendingAgentPreview?: MutationPreview | null
  pendingAgentHunkIds?: string[]
  agentExecutionPlan?: TaskExecutionStep[]
  awaitingAgentExecutionPlanApproval?: boolean
  onApproveAgentExecutionPlan?: (steps?: TaskExecutionStep[]) => void
  onSuggestAgentExecutionPlanChanges?: () => void
  onResumeAgentExecutionPlan?: () => void
  onRetryAgentExecutionPlan?: () => void
  onCancelAgentExecutionPlan?: () => void
  lastAppliedOperationId?: string | null
  onUndoLastAiOperation?: () => void
  aiOperationHistory?: AiOperationHistoryEntry[]
  onUndoAiOperation?: (operationId: string) => void
  aiOperationDiff?: AiOperationHistoryDiff | null
  onViewAiOperationDiff?: (operationId: string) => void
  onCloseAiOperationDiff?: () => void
  onConfirmAgentAction?: () => void
  onDeclineAgentAction?: () => void
  onEditAgentProposal?: () => void
  onToggleAgentHunk?: (hunkId: string) => void
  onSelectAgentClarificationOption?: (choice: string) => void
  threadRef: React.RefObject<HTMLDivElement | null>
  onOpenAiSettings?: () => void
}

export interface AiOperationHistoryDiff {
  operationId: string
  summary: string
  files: readonly {
    path: string
    previousSource: string
    nextSource: string
  }[]
}

function ChatThreadComponent({
  messages,
  isSubmitting,
  isChatLoading,
  isCheckingAiHealth,
  aiAvailabilityMessage,
  selectedChatFilePath,
  showHistoryPanel,
  streamingThinking,
  streamingAssistantMessage,
  pendingAgentQuestion,
  pendingAgentAnswer,
  pendingAgentConfirmation,
  pendingAgentPreview = null,
  pendingAgentHunkIds = [],
  agentExecutionPlan = [],
  awaitingAgentExecutionPlanApproval = false,
  onApproveAgentExecutionPlan,
  onSuggestAgentExecutionPlanChanges,
  onResumeAgentExecutionPlan,
  onRetryAgentExecutionPlan,
  onCancelAgentExecutionPlan,
  lastAppliedOperationId = null,
  onUndoLastAiOperation,
  aiOperationHistory = [],
  onUndoAiOperation,
  aiOperationDiff = null,
  onViewAiOperationDiff,
  onCloseAiOperationDiff,
  onConfirmAgentAction,
  onDeclineAgentAction,
  onEditAgentProposal,
  onToggleAgentHunk,
  onSelectAgentClarificationOption,
  threadRef,
  onOpenAiSettings,
}: ChatThreadProps) {
  const hasMessages = messages.length > 0
  const thinkingContentRef = useRef<HTMLDivElement | null>(null)
  const [isEditingPlan, setIsEditingPlan] = useState(false)
  const [draftPlan, setDraftPlan] = useState<TaskExecutionStep[]>([])

  useEffect(() => {
    if (isEditingPlan) return
    setDraftPlan(agentExecutionPlan.map((step) => ({
      ...step,
      affectedPaths: step.affectedPaths ? [...step.affectedPaths] : [],
      dependsOn: step.dependsOn ? [...step.dependsOn] : [],
    })))
  }, [agentExecutionPlan, isEditingPlan])

  useLayoutEffect(() => {
    const container = thinkingContentRef.current
    if (!container || !streamingThinking) {
      return
    }
    container.scrollTop = container.scrollHeight
  }, [streamingThinking])

  return (
    <section
      ref={threadRef}
      className="notia-chat-thread"
      tabIndex={-1}
      aria-live="polite"
    >
      {isCheckingAiHealth ? (
        <div className="notia-chat-empty">
          <strong>Verificando IA...</strong>
          <p>Esperá un momento antes de abrir el chat.</p>
        </div>
      ) : aiAvailabilityMessage ? (
        <div className="notia-chat-empty">
          <Bot size={18} />
          <strong>La IA no está disponible</strong>
          <p>{aiAvailabilityMessage}</p>
          {onOpenAiSettings ? (
            <button
              type="button"
              className="notia-chat-empty-action"
              onClick={onOpenAiSettings}
            >
              Configurar IA
            </button>
          ) : null}
        </div>
      ) : hasMessages ? (
        <>
          {messages.map((message, index) => (
            <article
              key={`${message.role}-${index}-${message.content.length}`}
              className={`notia-chat-message notia-chat-message--${message.role}`}
            >
              <div className="notia-chat-message-avatar" aria-hidden="true">
                {message.role === 'assistant' ? <Bot size={16} /> : <User2 size={16} />}
              </div>
              <div className="notia-chat-message-bubble">
                <span className="notia-chat-message-role">
                  {message.role === 'assistant' ? 'Asistente' : 'Vos'}
                </span>
                <ChatMarkdownMessage source={message.content} />
              </div>
            </article>
          ))}
          {agentExecutionPlan.length > 0 ? (
            <article className="notia-chat-message notia-chat-message--assistant">
              <div className="notia-chat-message-avatar" aria-hidden="true"><Bot size={16} /></div>
              <div className="notia-chat-message-bubble notia-chat-agent-plan">
                <span className="notia-chat-message-role">Plan de ejecución</span>
                <ol className="notia-chat-agent-plan-list">
                  {(isEditingPlan ? draftPlan : agentExecutionPlan).map((step) => (
                    <li key={step.id} className={`is-${step.status}`}>
                      <span className="notia-chat-agent-plan-status" aria-hidden="true">
                        {step.status === 'completed' ? <Check size={14} /> : step.status === 'in-progress' ? <LoaderCircle size={14} /> : step.status === 'blocked' || step.status === 'failed' || step.status === 'cancelled' ? <OctagonX size={14} /> : <Circle size={12} />}
                      </span>
                      <span>
                        <strong>{step.label}</strong>
                        {step.description ? <small>{step.description}</small> : null}
                        {step.affectedPaths?.length ? <small>Archivos: {step.affectedPaths.join(', ')}</small> : null}
                        {step.dependsOn?.length ? <small>Depende de: {step.dependsOn.join(', ')}</small> : null}
                        <small>{step.risk ? `Riesgo: ${step.risk}` : ''}{step.plannedToolName ? ` · ${telegramToolLabel(step.plannedToolName)}` : ''}</small>
                      </span>
                    </li>
                  ))}
                </ol>
                {awaitingAgentExecutionPlanApproval && isEditingPlan ? (
                  <div className="notia-chat-agent-plan-editor" aria-label="Editar plan de ejecucion">
                    {draftPlan.map((step, stepIndex) => (
                      <fieldset key={step.id} className="notia-chat-agent-plan-editor-step">
                        <legend>Paso {stepIndex + 1}</legend>
                        <label>
                          Nombre
                          <input value={step.label} onChange={(event) => setDraftPlan((current) => current.map((candidate) => candidate.id === step.id ? { ...candidate, label: event.target.value } : candidate))} />
                        </label>
                        <label>
                          Que hara
                          <textarea value={step.description ?? ''} onChange={(event) => setDraftPlan((current) => current.map((candidate) => candidate.id === step.id ? { ...candidate, description: event.target.value } : candidate))} rows={2} />
                        </label>
                        <label>
                          Archivos o entidades (separados por coma)
                          <input value={(step.affectedPaths ?? []).join(', ')} onChange={(event) => setDraftPlan((current) => current.map((candidate) => candidate.id === step.id ? { ...candidate, affectedPaths: event.target.value.split(',').map((value) => value.trim()).filter(Boolean) } : candidate))} />
                        </label>
                        <div className="notia-chat-agent-plan-editor-grid">
                          <label>
                            Herramienta
                            <input value={step.plannedToolName ?? ''} onChange={(event) => setDraftPlan((current) => current.map((candidate) => candidate.id === step.id ? { ...candidate, plannedToolName: event.target.value } : candidate))} />
                          </label>
                          <label>
                            Riesgo
                            <select value={step.risk ?? 'low'} onChange={(event) => setDraftPlan((current) => current.map((candidate) => candidate.id === step.id ? { ...candidate, risk: event.target.value as TaskExecutionStep['risk'] } : candidate))}>
                              <option value="low">Bajo</option>
                              <option value="medium">Medio</option>
                              <option value="high">Alto</option>
                              <option value="critical">Critico</option>
                            </select>
                          </label>
                        </div>
                        <label>
                          Depende de pasos (IDs separados por coma)
                          <input value={(step.dependsOn ?? []).join(', ')} onChange={(event) => setDraftPlan((current) => current.map((candidate) => candidate.id === step.id ? { ...candidate, dependsOn: event.target.value.split(',').map((value) => value.trim()).filter(Boolean) } : candidate))} />
                        </label>
                      </fieldset>
                    ))}
                  </div>
                ) : null}
                {awaitingAgentExecutionPlanApproval ? (
                  <div className="notia-chat-agent-confirmation-actions" role="group" aria-label="Revisar plan de ejecución">
                    <button type="button" className="notia-chat-agent-confirmation-button is-primary" onClick={() => { onApproveAgentExecutionPlan?.(isEditingPlan ? draftPlan : agentExecutionPlan); setIsEditingPlan(false) }}>
                      {isEditingPlan ? 'Guardar y aprobar' : 'Aprobar TO-DO'}
                    </button>
                    <button type="button" className="notia-chat-agent-confirmation-button" onClick={() => setIsEditingPlan((current) => !current)}>
                      {isEditingPlan ? 'Cerrar editor' : 'Editar plan'}
                    </button>
                    <button type="button" className="notia-chat-agent-confirmation-button" onClick={() => { setIsEditingPlan(false); onSuggestAgentExecutionPlanChanges?.() }}>
                      Sugerir cambios
                    </button>
                  </div>
                ) : null}
                {!isSubmitting && !awaitingAgentExecutionPlanApproval ? (
                  <div className="notia-chat-agent-confirmation-actions" role="group" aria-label="Continuar plan de ejecución">
                    {agentExecutionPlan.some((step) => step.status === 'failed' && step.canRetry !== false) ? (
                      <button type="button" className="notia-chat-agent-confirmation-button is-primary" onClick={onRetryAgentExecutionPlan}>
                        Reintentar paso fallido
                      </button>
                    ) : null}
                    {agentExecutionPlan.some((step) => step.status === 'pending' || step.status === 'in-progress' || step.status === 'blocked') ? (
                      <button type="button" className="notia-chat-agent-confirmation-button is-primary" onClick={onResumeAgentExecutionPlan}>
                        Continuar TO-DO
                      </button>
                    ) : null}
                    {agentExecutionPlan.some((step) => step.status === 'pending' || step.status === 'in-progress' || step.status === 'failed' || step.status === 'blocked') ? (
                      <button type="button" className="notia-chat-agent-confirmation-button" onClick={onCancelAgentExecutionPlan}>
                        Cancelar TO-DO
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </article>
          ) : null}
          {lastAppliedOperationId && onUndoLastAiOperation ? (
            <div className="notia-chat-agent-operation-actions" role="group" aria-label="Acciones del último cambio de IA">
              <span>Último cambio aplicado</span>
              <button type="button" className="notia-chat-agent-confirmation-button" onClick={onUndoLastAiOperation}>
                Deshacer
              </button>
            </div>
          ) : null}
          {aiOperationHistory.length > 0 ? (
            <details className="notia-chat-agent-operation-history">
              <summary>Historial de cambios ({aiOperationHistory.length})</summary>
              <ul>
                {aiOperationHistory.map((entry) => (
                  <li key={entry.operationId}>
                    <div>
                      <strong>{entry.summary}</strong>
                      <small>{entry.documentPath} · {new Date(entry.appliedAt).toLocaleString()}</small>
                      <small>{entry.status === 'undone' ? 'Deshecho' : 'Aplicado'}</small>
                    </div>
                    {entry.status === 'applied' && onUndoAiOperation ? (
                      <button
                        type="button"
                        className="notia-chat-agent-confirmation-button"
                        onClick={() => onUndoAiOperation(entry.operationId)}
                        disabled={isSubmitting}
                      >
                        Deshacer
                      </button>
                    ) : null}
                    {onViewAiOperationDiff ? (
                      <button
                        type="button"
                        className="notia-chat-agent-confirmation-button"
                        onClick={() => onViewAiOperationDiff(entry.operationId)}
                      >
                        Ver diff
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          {aiOperationDiff ? (
            <div className="notia-chat-agent-operation-diff" role="dialog" aria-label="Diff de operación de IA">
              <div className="notia-chat-diff-sheet-header">
                <strong>{aiOperationDiff.summary}</strong>
                <button type="button" className="notia-chat-agent-confirmation-button" onClick={onCloseAiOperationDiff}>
                  Cerrar
                </button>
              </div>
              {aiOperationDiff.files.map((file) => (
                <section key={file.path}>
                  <strong>{file.path}</strong>
                  <div className="notia-chat-agent-operation-diff-columns">
                    <div>
                      <small>Antes</small>
                      <pre>{file.previousSource || '(vacÃ­o)'}</pre>
                    </div>
                    <div>
                      <small>DespuÃ©s</small>
                      <pre>{file.nextSource || '(vacÃ­o)'}</pre>
                    </div>
                  </div>
                </section>
              ))}
            </div>
          ) : null}
          {isSubmitting || pendingAgentQuestion ? (
            <>
              {pendingAgentQuestion ? (
                <article className="notia-chat-message notia-chat-message--assistant">
                  <div className="notia-chat-message-avatar" aria-hidden="true">
                    <Bot size={16} />
                  </div>
                  <div className="notia-chat-message-bubble notia-chat-agent-confirmation">
                    <span className="notia-chat-message-role">Asistente · necesita una aclaración</span>
                    <ChatMarkdownMessage source={pendingAgentQuestion.question} />
                    {pendingAgentQuestion.choices.length > 0 ? (
                      <div className="notia-chat-agent-confirmation-actions" role="group" aria-label="Opciones de aclaración">
                        {pendingAgentQuestion.choices.map((choice) => (
                          <button
                            key={choice}
                            type="button"
                            className="notia-chat-agent-confirmation-button"
                            onClick={() => onSelectAgentClarificationOption?.(choice)}
                          >
                            {choice}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <span className="notia-chat-agent-interaction-hint">Respondé usando el campo de mensaje.</span>
                    )}
                  </div>
                </article>
              ) : null}
              {pendingAgentAnswer ? (
                <article className="notia-chat-message notia-chat-message--user">
                  <div className="notia-chat-message-avatar" aria-hidden="true">
                    <User2 size={16} />
                  </div>
                  <div className="notia-chat-message-bubble">
                    <span className="notia-chat-message-role">Vos</span>
                    <ChatMarkdownMessage source={pendingAgentAnswer} />
                  </div>
                </article>
              ) : null}
              {pendingAgentConfirmation ? (
                <article className="notia-chat-message notia-chat-message--assistant">
                  <div className="notia-chat-message-avatar" aria-hidden="true">
                    <Bot size={16} />
                  </div>
                  <div className="notia-chat-message-bubble notia-chat-agent-confirmation">
                    <span className="notia-chat-message-role">Asistente · requiere confirmación</span>
                    <ChatMarkdownMessage source={pendingAgentConfirmation} />
                    {pendingAgentPreview ? (
                      <div className="notia-chat-diff-preview" role="dialog" aria-modal="true" aria-label="Vista previa de cambios">
                        <div className="notia-chat-diff-sheet-header">
                          <strong>Vista previa de cambios</strong>
                          <button
                            type="button"
                            className="notia-chat-agent-confirmation-button"
                            onClick={onDeclineAgentAction}
                            aria-label="Cerrar vista previa"
                          >
                            Cerrar
                          </button>
                        </div>
                        <div className="notia-chat-diff-summary">
                          <strong>{pendingAgentPreview.summary}</strong>
                          {pendingAgentPreview.risk ? <span>Riesgo: {pendingAgentPreview.risk}</span> : null}
                          {pendingAgentPreview.documents.map((document) => (
                            <span key={document.path}>{document.path}</span>
                          ))}
                          <small>Contenido fuera de los hunks: se conserva sin cambios.</small>
                          {pendingAgentPreview.assumptions.length > 0 ? <small>Supuestos: {pendingAgentPreview.assumptions.join(' · ')}</small> : null}
                          {pendingAgentPreview.risks.length > 0 ? <small>Riesgos: {pendingAgentPreview.risks.join(' · ')}</small> : null}
                        </div>
                        <div className="notia-chat-diff-hunks">
                          {pendingAgentPreview.hunks.map((hunk, index) => {
                            const selected = pendingAgentHunkIds.includes(hunk.id)
                            return (
                              <label key={hunk.id} className={`notia-chat-diff-hunk${selected ? ' is-selected' : ''}`}>
                                <span className="notia-chat-diff-hunk-header">
                                  <input
                                    type="checkbox"
                                    checked={selected}
                                    onChange={() => onToggleAgentHunk?.(hunk.id)}
                                  />
                                  <span>Hunk {index + 1} · líneas {hunk.startLine}-{hunk.endLine}</span>
                                </span>
                                <pre className="notia-chat-diff-hunk-old">{hunk.oldText || '(vacío)'}</pre>
                                <pre className="notia-chat-diff-hunk-new">{hunk.newText || '(vacío)'}</pre>
                              </label>
                            )
                          })}
                        </div>
                      </div>
                    ) : null}
                    <div className="notia-chat-agent-confirmation-actions" role="group" aria-label="Confirmar acción del agente">
                      <button
                        type="button"
                        className="notia-chat-agent-confirmation-button is-primary"
                        onClick={onConfirmAgentAction}
                        disabled={Boolean(pendingAgentPreview && pendingAgentHunkIds.length === 0)}
                      >
                        {pendingAgentPreview && pendingAgentHunkIds.length < pendingAgentPreview.hunks.length ? 'Aplicar seleccionados' : 'Aplicar todo'}
                      </button>
                      <button type="button" className="notia-chat-agent-confirmation-button" onClick={onDeclineAgentAction}>
                        Cancelar
                      </button>
                      {onEditAgentProposal ? (
                        <button type="button" className="notia-chat-agent-confirmation-button" onClick={onEditAgentProposal}>
                          Editar propuesta
                        </button>
                      ) : null}
                    </div>
                  </div>
                </article>
              ) : null}
              {!pendingAgentQuestion && !pendingAgentConfirmation ? (
              <article className="notia-chat-message notia-chat-message--assistant">
                <div className="notia-chat-message-avatar" aria-hidden="true">
                  <Bot size={16} />
                </div>
                <div className="notia-chat-message-bubble notia-chat-message-bubble--thinking">
                  <span className="notia-chat-message-role">Progreso</span>
                  {streamingThinking.trim() ? (
                    <div
                      ref={thinkingContentRef}
                      className="notia-chat-thinking-content"
                      aria-live="polite"
                    >
                      <ChatMarkdownMessage source={streamingThinking} />
                    </div>
                  ) : (
                    <div className="notia-chat-thinking" role="status" aria-label="Pensando">
                      <span />
                      <span />
                      <span />
                    </div>
                  )}
                </div>
              </article>
              ) : null}
              {streamingAssistantMessage.trim() ? (
                <article className="notia-chat-message notia-chat-message--assistant">
                  <div className="notia-chat-message-avatar" aria-hidden="true">
                    <Bot size={16} />
                  </div>
                  <div className="notia-chat-message-bubble">
                    <span className="notia-chat-message-role">Asistente</span>
                    <ChatMarkdownMessage source={streamingAssistantMessage} />
                  </div>
                </article>
              ) : null}
            </>
          ) : null}
        </>
      ) : isChatLoading ? (
        <div className="notia-chat-empty">
          <strong>Cargando chat...</strong>
        </div>
      ) : (
        <div className="notia-chat-empty">
          <Bot size={18} />
          <strong>{selectedChatFilePath ? 'Empeza una conversacion' : 'Selecciona o crea un chat'}</strong>
          <p>
            {selectedChatFilePath
              ? 'Usa una sugerencia o escribi abajo para iniciar el chat con la IA.'
              : showHistoryPanel
                ? 'Escribí abajo para crear un chat automático o elegí uno existente para continuar.'
                : 'Escribí abajo y el panel lateral crea un chat automático con la configuración rápida.'}
          </p>
        </div>
      )}
    </section>
  )
}

export const ChatThread = memo(ChatThreadComponent)
ChatThread.displayName = 'ChatThread'
