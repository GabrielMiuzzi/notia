import { useCallback, useEffect, useState } from 'react'
import { Workflow, Zap } from 'lucide-react'
import type { NotiaLibrary } from '../../../types/notia'
import { useAiTasks } from '../hooks/useAiTasks'
import { useAiTaskThinking } from '../hooks/useAiTaskThinking'
import { aiTasksErrorMessage, answerAiTask, cancelAiTask, deleteAiTask, resumeAiTask } from '../services/aiTasksService'
import type { AiTaskAnswer, AiTaskCard } from '../types/aiTasksTypes'
import { AiTaskDetailPanel } from './AiTaskDetailPanel'
import '../styles/aiTasks.css'

const TOAST_DURATION_MS = 6000

function TaskCardView({ task, selected, onOpen }: { task: AiTaskCard; selected: boolean; onOpen: (id: string) => void }) {
  const progress = task.totalSteps === 0 ? 0 : Math.round((task.doneSteps / task.totalSteps) * 100)
  return (
    <li>
      <button type="button" className="ait-card" data-selected={selected} data-status={task.status} aria-current={selected ? 'true' : undefined} onClick={() => onOpen(task.id)}>
        <span className="ait-card__top">
          <span className="ait-chip" data-status={task.status}>{task.statusLabel}</span>
          {task.approveAll ? <Zap size={13} aria-label="Aprobar todo" /> : null}
          <span className="ait-card__origin">{task.originLabel}</span>
        </span>
        <span className="ait-card__title">{task.title}</span>
        <span className="ait-card__phase">{task.phaseLabel}</span>
        <span className="ait-progress" aria-hidden="true"><span style={{ width: `${progress}%` }} /></span>
        <span className="ait-card__time">{task.createdLabel}</span>
      </button>
    </li>
  )
}

/**
 * Tareas IA: lo largo que el asistente trabaja fuera del chat. Las crea solo
 * el agente; acá se siguen, se aprueban, se cancelan, se reanudan y se borran.
 */
export function AiTasksView({ library }: { library: NotiaLibrary }) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const { tasks, detail, status, loadError, reload } = useAiTasks(library, selectedId)

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), TOAST_DURATION_MS)
    return () => window.clearTimeout(timer)
  }, [toast])

  const run = useCallback(async (work: () => Promise<void>, done?: () => void) => {
    setBusy(true)
    try {
      await work()
      done?.()
    } catch (reason) {
      setToast(aiTasksErrorMessage(reason))
    } finally {
      setBusy(false)
      void reload()
    }
  }, [reload])

  const selected = detail && detail.id === selectedId ? detail : null
  const thinking = useAiTaskThinking(library, selected)

  return (
    <main className="notia-main ai-tasks-view" data-has-selection={Boolean(selectedId)}>
      <div className="ait-layout">
        <section className="ait-list" aria-labelledby="ait-list-title">
          <header className="ait-list__header">
            <Workflow size={20} strokeWidth={1.9} aria-hidden="true" />
            <div>
              <h1 id="ait-list-title">Tareas IA</h1>
              <p>Las crea el asistente cuando le pedís algo largo. Se guardan una semana.</p>
            </div>
          </header>
          {status === 'loading' && tasks.length === 0 ? <p className="ait-empty-line" role="status">Cargando las tareas…</p> : null}
          {status === 'error' ? <p className="ait-error" role="alert">{loadError}</p> : null}
          {status === 'ready' && tasks.length === 0 ? (
            <div className="ait-empty">
              <p>Todavía no hay tareas.</p>
              <p>Pedile algo con muchos pasos al asistente, desde un chat o Telegram, y va a crear la tarea acá: un Planificador arma el plan, un Ejecutor hace cada paso y un Review lo revisa.</p>
            </div>
          ) : null}
          <ul className="ait-cards">
            {tasks.map((task) => <TaskCardView key={task.id} task={task} selected={task.id === selectedId} onOpen={setSelectedId} />)}
          </ul>
        </section>
        <section className="ait-detail-pane" aria-label="Detalle de la tarea">
          {selected ? (
            <AiTaskDetailPanel
              task={selected}
              thinking={thinking}
              busy={busy}
              onBack={() => setSelectedId(null)}
              onAnswer={(approvalId: string, answer: AiTaskAnswer) => { void run(() => answerAiTask(library, selected.id, approvalId, answer)) }}
              onCancel={() => { void run(() => cancelAiTask(library, selected.id)) }}
              onResume={() => { void run(() => resumeAiTask(library, selected.id)) }}
              onDelete={() => { void run(() => deleteAiTask(library, selected.id), () => setSelectedId(null)) }}
            />
          ) : (
            <p className="ait-empty-line ait-detail-pane__hint">{selectedId ? 'Cargando la tarea…' : 'Elegí una tarea para ver su paso a paso.'}</p>
          )}
        </section>
      </div>
      {toast ? <div className="ait-toast" role="status">{toast}</div> : null}
    </main>
  )
}
