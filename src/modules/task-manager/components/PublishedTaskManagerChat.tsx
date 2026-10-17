import { useCallback, useEffect, useRef, useState } from 'react'
import { AppDialogModal } from '../../../components/notia/AppDialogModal'
import { ChatComposer } from '../../../components/notia/views/chat/ChatComposer'
import { ChatPanelHeader } from '../../../components/notia/views/chat/ChatPanelHeader'
import { ChatPanelWelcome } from '../../../components/notia/views/chat/ChatPanelWelcome'
import { ChatThread } from '../../../components/notia/views/chat/ChatThread'
import { DEFAULT_CHAT_STARTERS } from '../../../components/notia/views/chat/chatStarters'
import { buildRightPanelChatContextChip } from '../../../components/notia/hooks/useRightPanelChatContext'
import { startChatTurn, type ChatTurnHandle } from '../../../services/chat/aiChatRuntime'
import { describeAiFeedbackError } from '../../../services/ai/aiFeedbackRuntime'
import type { StoredChatMessage } from '../../../services/chat/chatDocumentStorage'
import type { TaskExecutionStep } from '../../../services/chat/chatAgentTypes'
import type { AgentConfirmationDecision, MutationPreview } from '../../../types/ai/agentContracts'
import type { NotiaLibrary } from '../../../types/notia'

/*
 * The chat of a published Task Manager, with the parts of the app's side
 * chat: its header (without agents or history: the chat is ephemeral), its
 * thread with the agent's questions, confirmations and plans, and its
 * composer. Turns run with the app's chat client; the publication server
 * runs them in Rust as the session's user, over the published boards only.
 * The conversation lives in this page and is lost when it closes.
 */

interface PublishedTaskManagerChatProps {
  library: NotiaLibrary
  /** Board or view open in the Task Manager, for the context chip. */
  panelId: string
  onClose: () => void
}

type PlanDecision = { approved: boolean; steps?: TaskExecutionStep[]; suggestion?: string; approveAll?: boolean }

const MODEL_LABEL = 'IA de Notia'
const NO_PATHS: string[] = []

export function PublishedTaskManagerChat({ library, panelId, onClose }: PublishedTaskManagerChatProps) {
  const [messages, setMessages] = useState<StoredChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [streamingThinking, setStreamingThinking] = useState('')
  const [streamingAssistantMessage, setStreamingAssistantMessage] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pendingQuestion, setPendingQuestion] = useState<{ question: string; choices: string[] } | null>(null)
  const [pendingConfirmation, setPendingConfirmation] = useState<string | null>(null)
  const [pendingPreview, setPendingPreview] = useState<MutationPreview | null>(null)
  const [pendingHunkIds, setPendingHunkIds] = useState<string[]>([])
  const [executionPlan, setExecutionPlan] = useState<TaskExecutionStep[]>([])
  const [awaitingPlanApproval, setAwaitingPlanApproval] = useState(false)
  const turnRef = useRef<ChatTurnHandle | null>(null)
  const clarificationResolverRef = useRef<((answer: string) => void) | null>(null)
  const confirmationResolverRef = useRef<((decision: AgentConfirmationDecision) => void) | null>(null)
  const planResolverRef = useRef<((decision: PlanDecision) => void) | null>(null)
  const threadRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const imageInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => () => turnRef.current?.abort(), [])

  const clearStreaming = () => {
    setStreamingThinking('')
    setStreamingAssistantMessage('')
  }

  const requestClarification = (question: string, signal: AbortSignal, choices: string[] = []) => new Promise<string>((resolve, reject) => {
    const handleAbort = () => {
      clarificationResolverRef.current = null
      setPendingQuestion(null)
      reject(new Error('Se canceló la aclaración solicitada por el agente.'))
    }
    signal.addEventListener('abort', handleAbort, { once: true })
    clarificationResolverRef.current = (answer) => {
      signal.removeEventListener('abort', handleAbort)
      clarificationResolverRef.current = null
      setPendingQuestion(null)
      resolve(answer)
    }
    setPendingQuestion({ question, choices })
    clearStreaming()
  })

  const requestConfirmation = (question: string, signal: AbortSignal, preview?: MutationPreview) => new Promise<boolean | AgentConfirmationDecision>((resolve, reject) => {
    const handleAbort = () => {
      confirmationResolverRef.current = null
      clarificationResolverRef.current = null
      setPendingQuestion(null)
      setPendingConfirmation(null)
      setPendingPreview(null)
      setPendingHunkIds([])
      reject(new Error('Se canceló la confirmación solicitada por el agente.'))
    }
    signal.addEventListener('abort', handleAbort, { once: true })
    confirmationResolverRef.current = (decision) => {
      signal.removeEventListener('abort', handleAbort)
      confirmationResolverRef.current = null
      setPendingConfirmation(null)
      setPendingPreview(null)
      setPendingHunkIds([])
      resolve(preview ? decision : decision.accepted)
    }
    setPendingConfirmation(question)
    setPendingPreview(preview ?? null)
    setPendingHunkIds(preview?.hunks.filter((hunk) => hunk.status !== 'rejected').map((hunk) => hunk.id) ?? [])
    clearStreaming()
  })

  const requestPlanApproval = (steps: TaskExecutionStep[], signal: AbortSignal) => new Promise<PlanDecision>((resolve, reject) => {
    const handleAbort = () => {
      planResolverRef.current = null
      clarificationResolverRef.current = null
      setAwaitingPlanApproval(false)
      setExecutionPlan([])
      setPendingQuestion(null)
      reject(new Error('Se canceló la aprobación del plan del agente.'))
    }
    signal.addEventListener('abort', handleAbort, { once: true })
    planResolverRef.current = (decision) => {
      signal.removeEventListener('abort', handleAbort)
      planResolverRef.current = null
      setAwaitingPlanApproval(false)
      setExecutionPlan([])
      resolve(decision)
    }
    setExecutionPlan(steps)
    setAwaitingPlanApproval(true)
    clearStreaming()
  })

  const send = async (text: string) => {
    const message = text.trim()
    if (!message || isSubmitting) return
    const previous = messages
    const previousDraft = draft
    let turnMessages: StoredChatMessage[] = [...previous, { role: 'user', content: message }]
    setMessages(turnMessages)
    setDraft('')
    setError(null)
    setIsSubmitting(true)
    clearStreaming()
    const turn = startChatTurn({
      libraryId: library.id,
      mode: 'published',
      message,
      chat: { kind: 'transient', messages: previous },
    }, {
      onAgentMessage: (agentMessage) => {
        turnMessages = [...turnMessages, agentMessage]
        setMessages(turnMessages)
        clearStreaming()
      },
      onAssistantNote: (note) => {
        turnMessages = [...turnMessages, { role: 'assistant', content: note }]
        setMessages(turnMessages)
        clearStreaming()
      },
      onThinkingDelta: (delta) => setStreamingThinking((current) => current + delta),
      onMessageDelta: (delta) => setStreamingAssistantMessage((current) => current + delta),
      requestClarification,
      requestConfirmation,
      requestExecutionPlanApproval: requestPlanApproval,
    })
    turnRef.current = turn
    try {
      const outcome = await turn.promise
      if (outcome.answer.trim()) setMessages([...turnMessages, { role: 'assistant', content: outcome.answer }])
      if (outcome.error) setError(outcome.error.message)
    } catch (turnError) {
      // As in the app: the conversation and the draft go back to before the
      // message, and the error shows in a dialog.
      setMessages(previous)
      setDraft(previousDraft)
      if (!(turnError instanceof DOMException && turnError.name === 'AbortError')) {
        setError(describeAiFeedbackError(turnError, 'No se pudo completar la consulta con la IA.'))
      }
    } finally {
      if (turnRef.current === turn) turnRef.current = null
      setIsSubmitting(false)
      clearStreaming()
    }
  }

  const submitText = (text: string) => {
    // While the agent waits for an answer, the composer answers it.
    const clarification = clarificationResolverRef.current
    if (clarification) {
      clarification(text.trim())
      setDraft('')
      return
    }
    void send(text)
  }

  const startNewChat = useCallback(() => {
    turnRef.current?.abort()
    setMessages([])
    setDraft('')
    setError(null)
  }, [])

  const awaitingClarification = Boolean(pendingQuestion && clarificationResolverRef.current)
  const lastAssistantMessage = [...messages].reverse().find((message) => message.role === 'assistant')?.content ?? null
  const isWelcome = messages.length === 0 && !isSubmitting

  return (
    <main className="notia-main notia-chat-view notia-published-chat" data-notia-prevent-menu-close>
      <section className="notia-chat-shell">
        <div className="notia-chat-layout">
          <section className="notia-chat-main">
            <ChatPanelHeader
              agents={[]}
              selectedAgentFileName=""
              isAgentChangeDisabled
              onSelectAgent={() => undefined}
              chatTitle={null}
              library={null}
              selectedChatFilePath={null}
              agentLookOf={() => ({ name: 'Notia', initials: 'N', colorIndex: 0 })}
              onPickChat={() => undefined}
              onNewChat={startNewChat}
              onDeleteChat={() => Promise.resolve()}
              onClose={onClose}
              showHistory={false}
            />
            {isWelcome ? (
              <ChatPanelWelcome
                agent={null}
                starters={DEFAULT_CHAT_STARTERS}
                isDisabled={isSubmitting}
                onSendStarter={(prompt) => void send(prompt)}
              />
            ) : (
              <ChatThread
                messages={messages}
                isSubmitting={isSubmitting}
                isChatLoading={false}
                isCheckingAiHealth={false}
                aiAvailabilityMessage={null}
                selectedChatFilePath={null}
                showHistoryPanel={false}
                streamingThinking={streamingThinking}
                streamingAssistantMessage={streamingAssistantMessage}
                pendingAgentQuestion={pendingQuestion}
                pendingAgentConfirmation={pendingConfirmation}
                pendingAgentPreview={pendingPreview}
                pendingAgentHunkIds={pendingHunkIds}
                agentExecutionPlan={executionPlan}
                awaitingAgentExecutionPlanApproval={awaitingPlanApproval}
                onApproveAgentExecutionPlan={(steps) => planResolverRef.current?.({ approved: true, steps })}
                onApproveAllAgentExecutionPlan={(steps) => planResolverRef.current?.({ approved: true, steps, approveAll: true })}
                onCancelAgentExecutionPlan={() => planResolverRef.current?.({ approved: false })}
                onSuggestAgentExecutionPlanChanges={() => {
                  const planResolver = planResolverRef.current
                  if (!planResolver) return
                  setAwaitingPlanApproval(false)
                  setPendingQuestion({ question: '¿Qué cambios querés hacerle al TO-DO?', choices: [] })
                  clarificationResolverRef.current = (suggestion) => {
                    clarificationResolverRef.current = null
                    setPendingQuestion(null)
                    planResolver({ approved: false, suggestion })
                  }
                }}
                onConfirmAgentAction={() => confirmationResolverRef.current?.({ accepted: true, hunkIds: pendingHunkIds })}
                onConfirmAllAgentActions={() => confirmationResolverRef.current?.({ accepted: true, hunkIds: pendingHunkIds, approveAll: true })}
                onDeclineAgentAction={() => confirmationResolverRef.current?.({ accepted: false })}
                onProposeAgentAlternative={() => {
                  const confirmationResolver = confirmationResolverRef.current
                  if (!confirmationResolver) return
                  setPendingConfirmation(null)
                  setPendingPreview(null)
                  setPendingQuestion({ question: '¿Qué querés que haga en su lugar?', choices: [] })
                  clarificationResolverRef.current = (suggestion) => {
                    clarificationResolverRef.current = null
                    setPendingQuestion(null)
                    confirmationResolver({ accepted: false, suggestion })
                  }
                }}
                onToggleAgentHunk={(hunkId) => {
                  setPendingHunkIds((current) => current.includes(hunkId)
                    ? current.filter((id) => id !== hunkId)
                    : [...current, hunkId])
                }}
                onSelectAgentClarificationOption={(choice) => clarificationResolverRef.current?.(choice)}
                threadRef={threadRef}
              />
            )}
            <ChatComposer
              variant="panel"
              draft={draft}
              setDraft={setDraft}
              canSubmit={draft.trim().length > 0 && (!isSubmitting || awaitingClarification)}
              isSubmitting={isSubmitting && !awaitingClarification}
              awaitingAgentClarification={awaitingClarification}
              isAiAvailable
              library={library}
              canAttach={false}
              canDictate={false}
              composerContext={buildRightPanelChatContextChip('task-manager', null, panelId, null)}
              activeModelLabel={MODEL_LABEL}
              selectedImageAttachments={[]}
              selectedLibraryFileSummary={[]}
              selectedLibraryFilePaths={NO_PATHS}
              effectiveSelectedContextPaths={NO_PATHS}
              effectiveSelectedContextMode="index"
              transientContextSummaryLabel={null}
              transientContextDisplayPaths={NO_PATHS}
              hasTransientContext={false}
              isAttachmentMenuOpen={false}
              attachmentMenuPosition={null}
              onRemoveImage={() => undefined}
              onRemoveFile={() => undefined}
              onToggleAttachmentMenu={() => undefined}
              onSelectImage={() => undefined}
              onOpenLibraryFilesModal={() => undefined}
              onSubmit={() => submitText(draft)}
              onSubmitText={submitText}
              lastAssistantMessage={lastAssistantMessage}
              onCancel={() => turnRef.current?.abort()}
              triggerRef={triggerRef}
              panelRef={panelRef}
              imageInputRef={imageInputRef}
            />
            <p className="notia-chat-panel-hint">Enter para enviar · Shift + Enter para salto de línea</p>
          </section>
          <AppDialogModal
            open={Boolean(error)}
            title="No se pudo completar la accion"
            message={error ?? ''}
            onConfirm={() => setError(null)}
            onClose={() => setError(null)}
          />
        </div>
      </section>
    </main>
  )
}
