import { useCallback, useEffect, useRef, useState } from 'react'
import { Clock, Play, Sparkles, Trash2, X } from 'lucide-react'
import { NotiaModalShell } from '../../../components/notia/NotiaModalShell'
import { ConfirmationDialogModal } from '../../../components/notia/ConfirmationDialogModal'
import type { NotiaLibrary } from '../../../types/notia'
import {
  aiActionsErrorFields,
  aiActionsErrorMessage,
  createAiAction,
  deleteAiAction,
  getAiAction,
  getAiActionRuns,
  previewAiAction,
  testAiPrompt,
  updateAiAction,
} from '../services/aiActionsService'
import type { ActionPreview, AiActionInput, AiActionKind, FieldError, RepeatUnit, RunRow } from '../types/aiActionsTypes'
import { KIND_VISUALS } from './aiActionsKinds'
import { StatusBadge } from './aiActionsVisuals'

const PREVIEW_DELAY_MS = 200

const KIND_OPTIONS: Array<{ kind: AiActionKind; title: string; description: string }> = [
  { kind: 'reminder', title: 'Recordatorio', description: 'Te avisa con un mensaje generado por el prompt.' },
  { kind: 'one-shot', title: 'Hora específica', description: 'Ejecuta el prompt una sola vez, a hora exacta.' },
  { kind: 'recurring', title: 'Recurrente', description: 'Repite el prompt cada cierto tiempo.' },
]

const UNIT_OPTIONS: Array<{ unit: RepeatUnit; label: string }> = [
  { unit: 'minutes', label: 'minutos' },
  { unit: 'hours', label: 'horas' },
  { unit: 'days', label: 'días' },
  { unit: 'weeks', label: 'semanas' },
]

const DAYS = [
  { short: 'L', name: 'lunes' },
  { short: 'M', name: 'martes' },
  { short: 'X', name: 'miércoles' },
  { short: 'J', name: 'jueves' },
  { short: 'V', name: 'viernes' },
  { short: 'S', name: 'sábado' },
  { short: 'D', name: 'domingo' },
]

const EMPTY_INPUT: AiActionInput = {
  kind: 'recurring',
  name: '',
  prompt: '',
  date: null,
  time: null,
  every: '1',
  unit: 'hours',
  weekdays: [0, 1, 2, 3, 4],
  from: null,
  to: null,
}

export type AiActionFormMode = { mode: 'create' } | { mode: 'edit'; actionId: string }

interface AiActionFormPanelProps {
  library: NotiaLibrary
  form: AiActionFormMode
  onClose: () => void
  onToast: (message: string) => void
}

function blankToNull(value: string): string | null {
  return value.trim() ? value : null
}

export function AiActionFormPanel({ library, form, onClose, onToast }: AiActionFormPanelProps) {
  const actionId = form.mode === 'edit' ? form.actionId : null
  const [input, setInput] = useState<AiActionInput>(EMPTY_INPUT)
  const [loaded, setLoaded] = useState(form.mode === 'create')
  const [builtin, setBuiltin] = useState(false)
  const [history, setHistory] = useState<RunRow[]>([])
  const [preview, setPreview] = useState<ActionPreview | null>(null)
  const [serverErrors, setServerErrors] = useState<FieldError[]>([])
  const [touched, setTouched] = useState<Set<string>>(new Set())
  const [submitted, setSubmitted] = useState(false)
  const [busy, setBusy] = useState<'save' | 'test' | 'delete' | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const previewTicket = useRef(0)

  useEffect(() => {
    if (!actionId) return
    let cancelled = false
    void Promise.all([getAiAction(library, actionId), getAiActionRuns(library, actionId)])
      .then(([stored, runs]) => {
        if (cancelled) return
        setInput(stored.input)
        setBuiltin(stored.builtin)
        setHistory(runs)
        setLoaded(true)
      })
      .catch((reason) => { if (!cancelled) setLoadError(aiActionsErrorMessage(reason)) })
    return () => { cancelled = true }
  }, [library, actionId])

  // Rust validates and explains the form while it is filled.
  useEffect(() => {
    if (!loaded) return
    const ticket = ++previewTicket.current
    const timer = window.setTimeout(() => {
      void previewAiAction(library, actionId, input)
        .then((next) => { if (ticket === previewTicket.current) setPreview(next) })
        .catch(() => undefined)
    }, PREVIEW_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [library, actionId, input, loaded])

  const update = useCallback((changes: Partial<AiActionInput>, field?: string) => {
    setInput((current) => ({ ...current, ...changes }))
    setServerErrors([])
    if (field) setTouched((current) => new Set(current).add(field))
  }, [])

  const errors = serverErrors.length > 0 ? serverErrors : (preview?.errors ?? [])
  const errorFor = (field: string): string | null => {
    if (!submitted && !touched.has(field)) return null
    return errors.find((error) => error.field === field)?.message ?? null
  }
  const canSave = loaded && preview !== null && preview.errors.length === 0 && busy === null

  const save = async () => {
    setSubmitted(true)
    if (!canSave) return
    setBusy('save')
    try {
      if (actionId) await updateAiAction(library, actionId, input)
      else await createAiAction(library, input)
      onToast(actionId ? 'Acción guardada.' : 'Acción creada.')
      onClose()
    } catch (reason) {
      const fields = aiActionsErrorFields(reason)
      if (fields.length > 0) setServerErrors(fields)
      else onToast(aiActionsErrorMessage(reason))
    } finally {
      setBusy(null)
    }
  }

  const test = async () => {
    setTouched((current) => new Set(current).add('prompt'))
    setBusy('test')
    try {
      await testAiPrompt(library, input)
      onToast('Prueba en marcha: la respuesta llega por Telegram con el prefijo «[Prueba]».')
    } catch (reason) {
      onToast(aiActionsErrorMessage(reason))
    } finally {
      setBusy(null)
    }
  }

  const remove = async () => {
    if (!actionId) return
    setConfirmDelete(false)
    setBusy('delete')
    try {
      await deleteAiAction(library, actionId)
      onToast('Acción eliminada. Su historial se conserva.')
      onClose()
    } catch (reason) {
      onToast(aiActionsErrorMessage(reason))
      setBusy(null)
    }
  }

  const recurring = input.kind === 'recurring'
  const withinDay = input.unit === 'minutes' || input.unit === 'hours'
  const fieldId = (name: string) => `aia-form-${name}`
  const errorLine = (field: string) => {
    const message = errorFor(field)
    return message ? <span className="aia-form__error" id={`${fieldId(field)}-error`} role="alert">{message}</span> : null
  }
  const describedBy = (field: string) => (errorFor(field) ? `${fieldId(field)}-error` : undefined)

  return (
    <NotiaModalShell open onClose={onClose} size="lg" panelClassName="aia-form-panel" panelStyle={{ width: 'min(640px, calc(100vw - 32px))' }}>
      <div className="aia-form">
        <header className="aia-form__header">
          <span className="aia-form__badge" aria-hidden="true"><Sparkles size={20} strokeWidth={1.75} /></span>
          <div className="aia-form__heading">
            <h2>{actionId ? 'Editar acción' : 'Nueva acción'}</h2>
            <p>Definí qué hace la IA, con qué prompt y cuándo.</p>
          </div>
          <button type="button" className="aia-icon-button" aria-label="Cerrar" onClick={onClose}>
            <X size={18} strokeWidth={2} />
          </button>
        </header>

        <div
          className="aia-form__body"
          onBlurCapture={(event) => {
            const id = (event.target as HTMLElement).id
            if (id.startsWith('aia-form-')) setTouched((current) => new Set(current).add(id.slice('aia-form-'.length)))
          }}
        >
          {loadError && <p className="aia-form__load-error" role="alert">{loadError}</p>}
          {builtin && (
            <p className="aia-form__note">Acción creada por Notia: es la revisión de cada hora que antes corría sola. Podés editarla, pausarla o eliminarla.</p>
          )}

          <fieldset className="aia-form__group">
            <legend className="aia-form__label">Tipo de acción</legend>
            <div className="aia-form__kinds">
              {KIND_OPTIONS.map((option) => {
                const Icon = KIND_VISUALS[option.kind].icon
                return (
                  <button
                    key={option.kind}
                    type="button"
                    className="aia-kind"
                    aria-pressed={input.kind === option.kind}
                    onClick={() => update({ kind: option.kind }, 'kind')}
                  >
                    <Icon size={18} strokeWidth={1.9} data-accent={KIND_VISUALS[option.kind].accent} aria-hidden="true" />
                    <span className="aia-kind__title">{option.title}</span>
                    <span className="aia-kind__description">{option.description}</span>
                  </button>
                )
              })}
            </div>
          </fieldset>

          <label className="aia-form__field" htmlFor={fieldId('name')}>
            <span className="aia-form__label">Nombre</span>
            <input
              id={fieldId('name')}
              type="text"
              maxLength={80}
              placeholder="Ej.: Resumen de correos"
              value={input.name}
              aria-invalid={Boolean(errorFor('name'))}
              aria-describedby={describedBy('name')}
              onChange={(event) => update({ name: event.target.value }, 'name')}
            />
            {errorLine('name')}
          </label>

          <label className="aia-form__field" htmlFor={fieldId('prompt')}>
            <span className="aia-form__label-row">
              <span className="aia-form__label">Prompt</span>
              <span className="aia-form__hint-accent"><Sparkles size={13} strokeWidth={1.9} aria-hidden="true" />Lo que la IA va a ejecutar</span>
            </span>
            <textarea
              id={fieldId('prompt')}
              rows={5}
              placeholder="Describí qué tiene que hacer la IA. Ej.: Leé los correos sin leer de la cuenta Laboral, resumilos en 5 puntos y guardalos en una nota de Inbox."
              value={input.prompt}
              aria-invalid={Boolean(errorFor('prompt'))}
              aria-describedby={[`${fieldId('prompt')}-help`, describedBy('prompt')].filter(Boolean).join(' ')}
              onChange={(event) => update({ prompt: event.target.value }, 'prompt')}
            />
            <span className="aia-form__help" id={`${fieldId('prompt')}-help`}>Se usa tal cual cada vez que se ejecuta. Indicá qué leer, qué hacer y dónde dejar el resultado.</span>
            {errorLine('prompt')}
          </label>

          <div className="aia-form__group">
            <span className="aia-form__label">Cuándo</span>
            {!recurring ? (
              <div className="aia-form__pair">
                <label className="aia-form__field" htmlFor={fieldId('date')}>
                  <span className="aia-form__sublabel">Fecha</span>
                  <input
                    id={fieldId('date')}
                    type="date"
                    value={input.date ?? ''}
                    aria-invalid={Boolean(errorFor('date'))}
                    aria-describedby={describedBy('date')}
                    onChange={(event) => update({ date: blankToNull(event.target.value) }, 'date')}
                  />
                  {errorLine('date')}
                </label>
                <label className="aia-form__field" htmlFor={fieldId('time')}>
                  <span className="aia-form__sublabel">Hora</span>
                  <input
                    id={fieldId('time')}
                    type="time"
                    value={input.time ?? ''}
                    aria-invalid={Boolean(errorFor('time'))}
                    aria-describedby={describedBy('time')}
                    onChange={(event) => update({ time: blankToNull(event.target.value) }, 'time')}
                  />
                  {errorLine('time')}
                </label>
              </div>
            ) : (
              <div className="aia-form__recurrence">
                <div className="aia-form__every">
                  <label className="aia-form__field aia-form__field--every" htmlFor={fieldId('every')}>
                    <span className="aia-form__sublabel">Repetir cada</span>
                    <input
                      id={fieldId('every')}
                      type="number"
                      inputMode="numeric"
                      min={1}
                      step={1}
                      value={input.every ?? ''}
                      aria-invalid={Boolean(errorFor('every'))}
                      aria-describedby={describedBy('every')}
                      onChange={(event) => update({ every: blankToNull(event.target.value) }, 'every')}
                    />
                  </label>
                  <label className="aia-form__field aia-form__field--grow" htmlFor={fieldId('unit')}>
                    <span className="aia-form__sublabel">Unidad</span>
                    <select
                      id={fieldId('unit')}
                      value={input.unit ?? 'hours'}
                      onChange={(event) => update({ unit: event.target.value as RepeatUnit }, 'unit')}
                    >
                      {UNIT_OPTIONS.map((option) => <option key={option.unit} value={option.unit}>{option.label}</option>)}
                    </select>
                  </label>
                </div>
                {errorLine('every')}
                <div className="aia-form__field">
                  <span className="aia-form__sublabel" id={fieldId('weekdays')}>Días</span>
                  <div className="aia-form__days" role="group" aria-labelledby={fieldId('weekdays')}>
                    {DAYS.map((day, index) => {
                      const on = input.weekdays.includes(index)
                      return (
                        <button
                          key={day.short}
                          type="button"
                          className="aia-day"
                          aria-label={day.name}
                          aria-pressed={on}
                          onClick={() => update({
                            weekdays: on ? input.weekdays.filter((value) => value !== index) : [...input.weekdays, index].sort((a, b) => a - b),
                          }, 'weekdays')}
                        >
                          {day.short}
                        </button>
                      )
                    })}
                  </div>
                  {errorLine('weekdays')}
                </div>
                <div className="aia-form__pair">
                  <label className="aia-form__field" htmlFor={fieldId('from')}>
                    <span className="aia-form__sublabel">
                      {withinDay ? <>Desde <span className="aia-form__optional">(opcional)</span></> : 'Hora de ejecución'}
                    </span>
                    <input
                      id={fieldId('from')}
                      type="time"
                      value={input.from ?? ''}
                      aria-invalid={Boolean(errorFor('from'))}
                      aria-describedby={describedBy('from')}
                      onChange={(event) => update({ from: blankToNull(event.target.value) }, 'from')}
                    />
                    {errorLine('from')}
                  </label>
                  {withinDay && (
                    <label className="aia-form__field" htmlFor={fieldId('to')}>
                      <span className="aia-form__sublabel">Hasta <span className="aia-form__optional">(opcional)</span></span>
                      <input
                        id={fieldId('to')}
                        type="time"
                        value={input.to ?? ''}
                        aria-invalid={Boolean(errorFor('to'))}
                        aria-describedby={describedBy('to')}
                        onChange={(event) => update({ to: blankToNull(event.target.value) }, 'to')}
                      />
                      {errorLine('to')}
                    </label>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="aia-form__summary" aria-live="polite">
            <Clock size={18} strokeWidth={1.9} aria-hidden="true" />
            <div>
              <p>{preview?.summary ?? ''}</p>
              {preview && preview.upcoming.length > 0 && (
                <ul className="aia-form__upcoming" aria-label="Próximas ejecuciones">
                  {preview.upcoming.map((label) => <li key={label}>{label}</li>)}
                </ul>
              )}
            </div>
          </div>

          {actionId && (
            <section className="aia-form__history" aria-labelledby="aia-form-history-title">
              <h3 id="aia-form-history-title" className="aia-form__label">Historial</h3>
              {history.length === 0 ? (
                <p className="aia-form__help">Todavía no se ejecutó.</p>
              ) : (
                <ul>
                  {history.map((run) => (
                    <li key={run.id} className="aia-history-row">
                      <span className="aia-history-row__when">{run.when}</span>
                      <span className="aia-history-row__trigger">{run.trigger}</span>
                      <StatusBadge status={run.status} />
                      {run.note && <span className="aia-history-row__note">{run.note}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>

        <footer className="aia-form__footer">
          {actionId ? (
            <button type="button" className="aia-button aia-button--danger" disabled={busy !== null} onClick={() => setConfirmDelete(true)}>
              <Trash2 size={15} strokeWidth={2} aria-hidden="true" />
              Eliminar
            </button>
          ) : (
            <button type="button" className="aia-button aia-button--ghost" onClick={onClose}>Cancelar</button>
          )}
          <span className="aia-form__spacer">
            {loaded && preview !== null && preview.errors.length > 0 && <span className="aia-form__blocked">Completá o corregí los campos para guardar.</span>}
          </span>
          {actionId && <button type="button" className="aia-button aia-button--ghost" onClick={onClose}>Cancelar</button>}
          <button type="button" className="aia-button" disabled={busy !== null || !loaded} onClick={() => { void test() }}>
            <Play size={15} strokeWidth={2} aria-hidden="true" />
            {busy === 'test' ? 'Probando…' : 'Probar ahora'}
          </button>
          <button type="button" className="aia-button aia-button--primary" disabled={!canSave} onClick={() => { void save() }}>
            {busy === 'save' ? 'Guardando…' : 'Guardar acción'}
          </button>
        </footer>
      </div>
      <ConfirmationDialogModal
        open={confirmDelete}
        title="Eliminar acción"
        message={`Se elimina «${input.name || 'esta acción'}». Su historial de ejecuciones se conserva.`}
        confirmLabel="Eliminar"
        tone="danger"
        onConfirm={() => { void remove() }}
        onCancel={() => setConfirmDelete(false)}
      />
    </NotiaModalShell>
  )
}
