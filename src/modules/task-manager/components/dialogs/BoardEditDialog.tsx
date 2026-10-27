import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react'
import '../../styles/taskManagerTokens.css'
import '../../styles/taskBoardEdit.css'
import type { LibraryContext } from '../../../../services/contexts/libraryContexts'
import { readBoardPlanPreview, type TaskManagerBackendContext } from '../../services/taskManagerService'
import type { TaskBoardPlan, TaskBoardPlanPreview, TaskPaletteColor } from '../../types/taskBoardTypes'
import type { Board } from '../../types/taskManagerTypes'

export interface BoardEditDialogProps {
  open: boolean
  mode: 'create' | 'edit'
  /** The board being edited; null when creating. */
  board: Board | null
  /** Colors the board can take (snapshot.palette). */
  palette: TaskPaletteColor[]
  /** Context tags of the library (#Laboral, #Estudiantil, #Personal, ...). */
  contexts: LibraryContext[]
  context: TaskManagerBackendContext
  /** The default board keeps its name and color: inputs disabled. */
  lockNameAndColor: boolean
  onClose: () => void
  /** Parent sends the create/update intent; reject → show the error in the footer and stay open. */
  onSave: (value: { name: string; color: string; contexto: string; plan: TaskBoardPlan }) => Promise<void>
  /** «Eliminar tablero» at the end of the phone screen; none hides it. */
  onDelete?: () => void
}

interface BoardEditValue {
  name: string
  color: string
  contexto: string
  plan: TaskBoardPlan
}

type BumpKey = 'color' | 'ctx' | 'hrs' | 'sprint' | 'div'

/** Plan a new board starts with; Rust applies the same defaults. */
const DEFAULT_PLAN: TaskBoardPlan = {
  dayStartMinutes: 540,
  dayEndMinutes: 1080,
  workDays: [true, true, true, true, true, false, false],
  sprintWeeks: 2,
  sprintStartWeekday: 0,
  divisionsPerYear: 4,
  divisionPrefix: 'Q',
  yearStartMonth: 1,
}

const DEFAULT_CONTEXT = '#Personal'
const STEP_MINUTES = 30
const DAY_STEPS = 48
const PREVIEW_DELAY_MS = 150
const SAVED_NOTICE_MS = 2400
const MIN_SPRINT_WEEKS = 1
const MAX_SPRINT_WEEKS = 8
const MIN_DIVISIONS = 1
const MAX_DIVISIONS = 12
const PREFIX_MAX_CHARS = 4

const DAYS = [
  ['L', 'Lunes'],
  ['M', 'Martes'],
  ['X', 'Miércoles'],
  ['J', 'Jueves'],
  ['V', 'Viernes'],
  ['S', 'Sábado'],
  ['D', 'Domingo'],
] as const

const HOUR_GRID = [0, 3, 6, 9, 12, 15, 18, 21, 24]
const SPRINT_QUICK = [1, 2, 3, 4]
const DIVISION_QUICK: Array<[number, string]> = [
  [2, 'Semestres'],
  [3, 'Cuatrimestres'],
  [4, 'Trimestres · Q'],
  [6, 'Bimestres'],
  [12, 'Meses'],
]
const MONTHS = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]

const CONTEXT_ICONS: Record<string, string> = {
  laboral: 'M4 8h16v11H4zM9 8V5h6v3',
  estudiantil: 'M3 9l9-4 9 4-9 4zM7 11v4c3 2 7 2 10 0v-4',
  personal: 'M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z',
}
const CUSTOM_CONTEXT_ICON = 'M5 12h14M12 5v14'

function contextIcon(tag: string): string {
  return CONTEXT_ICONS[tag.replace(/^#/, '').toLowerCase()] ?? CUSTOM_CONTEXT_ICON
}

function sameTag(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}

function sameColor(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

function initialValue(
  mode: BoardEditDialogProps['mode'],
  board: Board | null,
  palette: TaskPaletteColor[],
  contexts: LibraryContext[],
): BoardEditValue {
  if (mode === 'edit' && board) {
    return {
      name: board.name,
      color: board.color,
      contexto: board.contexto ?? DEFAULT_CONTEXT,
      plan: { ...board.plan, workDays: [...board.plan.workDays] as TaskBoardPlan['workDays'] },
    }
  }
  const personal = contexts.find((item) => sameTag(item.tag, DEFAULT_CONTEXT))
  return {
    name: '',
    color: palette[0]?.color ?? '',
    contexto: personal?.tag ?? contexts[0]?.tag ?? DEFAULT_CONTEXT,
    plan: { ...DEFAULT_PLAN, workDays: [...DEFAULT_PLAN.workDays] as TaskBoardPlan['workDays'] },
  }
}

function sameValue(a: BoardEditValue, b: BoardEditValue): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback
}

/** Position on a track whose ends are inset by half a thumb. */
function trackLeft(fraction: number): string {
  return `calc(var(--tbe-thumb-half) + (100% - var(--tbe-thumb-w)) * ${fraction})`
}

function bumpClass(count: number | undefined): string {
  if (!count) return ''
  return count % 2 ? 'tbe-pop-a' : 'tbe-pop-b'
}

/** Arrow keys move the choice inside a role="radiogroup". */
function handleRadioGroupKeys(event: ReactKeyboardEvent<HTMLElement>) {
  const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End']
  if (!keys.includes(event.key)) return
  const radios = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]:not(:disabled)'))
  const current = radios.indexOf(document.activeElement as HTMLButtonElement)
  if (current < 0 || radios.length === 0) return
  event.preventDefault()
  let next = current
  if (event.key === 'Home') next = 0
  else if (event.key === 'End') next = radios.length - 1
  else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (current + 1) % radios.length
  else next = (current - 1 + radios.length) % radios.length
  radios[next].focus()
  radios[next].click()
}

/** Roving tab stop: the checked radio, or the first one when none is. */
function radioTabIndex(checked: boolean, index: number, anyChecked: boolean): number {
  return checked || (!anyChecked && index === 0) ? 0 : -1
}

const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])'

function Icon({ path, size = 14, strokeWidth = 2 }: { path: string; size?: number; strokeWidth?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <path d={path} />
    </svg>
  )
}

const CHECK_PATH = 'M5 12.5l4.5 4.5L19 7.5'
const MINUS_PATH = 'M5 12h14'
const PLUS_PATH = 'M12 5v14M5 12h14'
const CLOSE_PATH = 'M6 6l12 12M18 6L6 18'
const TRASH_PATH = 'M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3'
const CHEVRON_PATH = 'M6 9l6 6 6-6'

export function BoardEditDialog(props: BoardEditDialogProps) {
  if (!props.open) return null
  return <BoardEditDialogBody {...props} />
}

function BoardEditDialogBody({
  mode,
  board,
  palette,
  contexts,
  context,
  lockNameAndColor,
  onClose,
  onSave,
  onDelete,
}: BoardEditDialogProps) {
  const ids = useId()
  const [initial, setInitial] = useState<BoardEditValue>(() => initialValue(mode, board, palette, contexts))
  const [value, setValue] = useState<BoardEditValue>(initial)
  const [addedTags, setAddedTags] = useState<string[]>([])
  const [addingContext, setAddingContext] = useState(false)
  const [newContext, setNewContext] = useState('')
  const [bumps, setBumps] = useState<Partial<Record<BumpKey, number>>>({})
  const [lastThumb, setLastThumb] = useState<'start' | 'end'>('end')
  const [preview, setPreview] = useState<TaskBoardPlanPreview | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [justSaved, setJustSaved] = useState(false)

  const dialogRef = useRef<HTMLDivElement | null>(null)
  const nameRef = useRef<HTMLInputElement | null>(null)
  const savedTimerRef = useRef<number | null>(null)

  const { name, color, contexto, plan } = value
  const dirty = !sameValue(value, initial)
  const canSave = dirty && !saving && name.trim() !== ''

  // Focus goes into the dialog when it opens and back where it was when it closes.
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const target = nameRef.current && !nameRef.current.disabled ? nameRef.current : dialogRef.current
    target?.focus({ preventScroll: true })
    return () => {
      if (previous && document.contains(previous)) previous.focus({ preventScroll: true })
    }
  }, [])

  useEffect(() => () => {
    if (savedTimerRef.current !== null) window.clearTimeout(savedTimerRef.current)
  }, [])

  // The preview is Rust's: it is asked again (at most every 150 ms) whenever
  // the edited settings change; only the newest answer is shown.
  const request = useMemo(
    () => ({ boardName: name.trim() || 'Sin nombre', contexto, plan }),
    [name, contexto, plan],
  )
  const latestRequestRef = useRef(request)
  const previewTimerRef = useRef<number | null>(null)
  const requestSeqRef = useRef(0)
  const contextRef = useRef(context)

  useEffect(() => {
    latestRequestRef.current = request
    contextRef.current = context
    if (previewTimerRef.current !== null) return
    previewTimerRef.current = window.setTimeout(() => {
      previewTimerRef.current = null
      const seq = requestSeqRef.current + 1
      requestSeqRef.current = seq
      setPreviewLoading(true)
      readBoardPlanPreview(contextRef.current, latestRequestRef.current).then(
        (next) => {
          if (seq !== requestSeqRef.current) return
          setPreview(next)
          setPreviewError(null)
          setPreviewLoading(false)
        },
        (error: unknown) => {
          if (seq !== requestSeqRef.current) return
          setPreviewError(errorMessage(error, 'No se pudo calcular la vista previa.'))
          setPreviewLoading(false)
        },
      )
    }, PREVIEW_DELAY_MS)
  }, [request, context])

  useEffect(() => () => {
    if (previewTimerRef.current !== null) window.clearTimeout(previewTimerRef.current)
    previewTimerRef.current = null
    requestSeqRef.current += 1
  }, [])

  const update = (patch: Partial<BoardEditValue>, bump?: BumpKey) => {
    setValue((current) => ({ ...current, ...patch }))
    setJustSaved(false)
    setSaveError(null)
    if (bump) setBumps((current) => ({ ...current, [bump]: (current[bump] ?? 0) + 1 }))
  }

  const updatePlan = (patch: Partial<TaskBoardPlan>, bump?: BumpKey) => {
    update({ plan: { ...plan, ...patch } }, bump)
  }

  const contextTags = useMemo(() => {
    const tags: string[] = []
    for (const tag of [...contexts.map((item) => item.tag), initial.contexto, ...addedTags]) {
      if (tag && !tags.some((known) => sameTag(known, tag))) tags.push(tag)
    }
    return tags
  }, [contexts, initial.contexto, addedTags])

  const confirmNewContext = () => {
    const typed = newContext.trim()
    setAddingContext(false)
    setNewContext('')
    if (!typed) return
    const tag = `#${typed}`
    const existing = contextTags.find((known) => sameTag(known, tag))
    if (!existing) setAddedTags((current) => [...current, tag])
    update({ contexto: existing ?? tag }, 'ctx')
  }

  const handleNewContextKeys = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      confirmNewContext()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      setAddingContext(false)
      setNewContext('')
    }
  }

  const startStep = plan.dayStartMinutes / STEP_MINUTES
  const endStep = plan.dayEndMinutes / STEP_MINUTES

  const setStartStep = (step: number) => {
    setLastThumb('start')
    updatePlan({ dayStartMinutes: Math.min(step, endStep - 1) * STEP_MINUTES }, 'hrs')
  }

  const setEndStep = (step: number) => {
    setLastThumb('end')
    updatePlan({ dayEndMinutes: Math.max(step, startStep + 1) * STEP_MINUTES }, 'hrs')
  }

  const toggleDay = (index: number) => {
    const workDays = [...plan.workDays] as TaskBoardPlan['workDays']
    workDays[index] = !workDays[index]
    updatePlan({ workDays }, 'hrs')
  }

  const handleSave = async () => {
    if (!canSave) return
    const next: BoardEditValue = { ...value, name: name.trim() }
    setSaving(true)
    setSaveError(null)
    try {
      await onSave(next)
      setValue(next)
      setInitial(next)
      setJustSaved(true)
      if (savedTimerRef.current !== null) window.clearTimeout(savedTimerRef.current)
      savedTimerRef.current = window.setTimeout(() => setJustSaved(false), SAVED_NOTICE_MS)
    } catch (error) {
      setSaveError(errorMessage(error, 'No se pudo guardar el tablero.'))
    } finally {
      setSaving(false)
    }
  }

  const handleDialogKeys = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onClose()
      return
    }
    if (event.key !== 'Tab' || !dialogRef.current) return
    const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE))
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  const workday = preview?.workday
  const sprints = preview?.sprints
  const divisions = preview?.divisions
  const workdayTitle = workday?.title ?? 'Jornada'
  const prefixShown = plan.divisionPrefix.trim() || 'Q'
  const anyColorChecked = palette.some((item) => sameColor(item.color, color))
  const anyContextChecked = contextTags.some((tag) => sameTag(tag, contexto))
  const titleId = `${ids}-title`
  const tileStyle = {
    color,
    background: `color-mix(in srgb, ${color} 14%, transparent)`,
  } satisfies CSSProperties
  const todayLabel = divisions?.todayLabel ?? ''
  const todayPrefix = todayLabel.startsWith('Hoy: ') ? 'Hoy: ' : ''
  const isCreate = mode === 'create'

  return (
    <div className="tbe-overlay">
      <div className="tbe-frame">
        <div
          ref={dialogRef}
          className="tbe-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          onKeyDown={handleDialogKeys}
        >
          <header className="tbe-header">
            <span className={`tbe-tile ${bumpClass(bumps.color)}`} style={tileStyle}>
              <svg aria-hidden="true" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
                <rect x="3.5" y="4" width="17" height="16" rx="2" />
                <path d="M9.5 4v16M15 4v16" />
              </svg>
            </span>
            <div className="tbe-header-text">
              <h1 id={titleId} className="tbe-title">{isCreate ? 'Nuevo tablero' : 'Editar tablero'}</h1>
              <span className="tbe-summary">{preview?.summary ?? ' '}</span>
            </div>
            <button type="button" className="tbe-icon-button tbe-close" aria-label="Cerrar y volver al tablero" onClick={onClose}>
              <Icon path={CLOSE_PATH} strokeWidth={2.2} />
            </button>
            {/* The phone screen saves from its header too (canvas «Mobile · Editar tablero»). */}
            <button
              type="button"
              className="tbe-button tbe-button--primary tbe-header-save"
              disabled={!canSave}
              aria-busy={saving}
              onClick={() => void handleSave()}
            >
              {isCreate ? 'Crear' : 'Guardar'}
            </button>
          </header>

          <div className="tbe-body" aria-busy={previewLoading}>
            <section className="tbe-section" aria-labelledby={`${ids}-general`} style={{ animationDelay: '80ms' }}>
              <h2 id={`${ids}-general`} className="tbe-h2">General</h2>
              <div className="tbe-grid-2">
                <label className="tbe-field-block">
                  <span className="tbe-label">Nombre</span>
                  <span className="tbe-field">
                    <input
                      ref={nameRef}
                      className="tbe-input"
                      value={name}
                      onChange={(event) => update({ name: event.target.value })}
                      aria-label="Nombre del tablero"
                      disabled={lockNameAndColor}
                    />
                  </span>
                </label>
                <div className="tbe-field-block">
                  <span id={`${ids}-color`} className="tbe-label">Color</span>
                  <div role="radiogroup" aria-labelledby={`${ids}-color`} className="tbe-swatches" onKeyDown={handleRadioGroupKeys}>
                    {palette.map((item, index) => {
                      const checked = sameColor(item.color, color)
                      return (
                        <button
                          key={item.color}
                          type="button"
                          role="radio"
                          aria-checked={checked}
                          aria-label={item.name}
                          tabIndex={radioTabIndex(checked, index, anyColorChecked)}
                          disabled={lockNameAndColor}
                          className={`tbe-swatch${checked ? ' is-checked' : ''}`}
                          style={{ background: item.color, '--tbe-swatch': item.color } as CSSProperties}
                          onClick={() => update({ color: item.color }, 'color')}
                        />
                      )
                    })}
                  </div>
                </div>
              </div>
              <div className="tbe-field-block tbe-field-block--wide">
                <span id={`${ids}-ctx`} className="tbe-label">Contexto</span>
                <div role="radiogroup" aria-labelledby={`${ids}-ctx`} className="tbe-chip-row" onKeyDown={handleRadioGroupKeys}>
                  {contextTags.map((tag, index) => {
                    const checked = sameTag(tag, contexto)
                    return (
                      <button
                        key={tag}
                        type="button"
                        role="radio"
                        aria-checked={checked}
                        tabIndex={radioTabIndex(checked, index, anyContextChecked)}
                        className={`tbe-chip tbe-chip--context${checked ? ' is-on' : ''}`}
                        onClick={() => update({ contexto: tag }, 'ctx')}
                      >
                        <span className="tbe-chip-icon"><Icon path={contextIcon(tag)} /></span>
                        {tag}
                      </button>
                    )
                  })}
                  {addingContext ? (
                    <span className="tbe-field tbe-new-context tbe-pop-a">
                      <span className="tbe-muted">#</span>
                      <input
                        autoFocus
                        className="tbe-input tbe-new-context-input"
                        aria-label="Nombre del nuevo contexto"
                        placeholder="Nuevo contexto"
                        value={newContext}
                        onChange={(event) => setNewContext(event.target.value.replace(/[#\s]/g, ''))}
                        onKeyDown={handleNewContextKeys}
                      />
                      <button type="button" className="tbe-confirm" aria-label="Agregar contexto" onClick={confirmNewContext}>
                        <Icon path={CHECK_PATH} size={12} strokeWidth={3} />
                      </button>
                    </span>
                  ) : (
                    <button type="button" className="tbe-chip tbe-chip--new" onClick={() => setAddingContext(true)}>
                      <Icon path={PLUS_PATH} size={13} strokeWidth={2.4} />
                      Nuevo
                    </button>
                  )}
                </div>
                <span className="tbe-hint">El contexto define cómo se llama y se mide la jornada del tablero.</span>
              </div>
            </section>

            <section className="tbe-section" aria-labelledby={`${ids}-workday`} style={{ animationDelay: '160ms' }}>
              <div className="tbe-section-head tbe-section-head--split">
                <div className="tbe-section-title">
                  <h2 id={`${ids}-workday`} className={`tbe-h2 ${bumpClass(bumps.ctx)}`}>{workdayTitle}</h2>
                  <span className="tbe-sub">{workday?.hint ?? ' '}</span>
                </div>
                <div className="tbe-hours">
                  <span className={`tbe-hours-day ${bumpClass(bumps.hrs)}`}>
                    {workday?.hoursPerDay ?? '—'}
                    <span className="tbe-hours-unit">h/día</span>
                  </span>
                  <span className="tbe-hours-week">{workday?.hoursPerWeek ?? ' '}</span>
                </div>
              </div>

              <div className="tbe-range-block">
                <div className="tbe-range-labels">
                  <span><span className="tbe-muted">Desde </span><strong>{workday?.startLabel ?? ''}</strong></span>
                  <span><span className="tbe-muted">Hasta </span><strong>{workday?.endLabel ?? ''}</strong></span>
                </div>
                <div className="tbe-range">
                  {HOUR_GRID.map((hour) => (
                    <span key={hour} aria-hidden="true" className="tbe-range-grid" style={{ left: trackLeft(hour / 24) }} />
                  ))}
                  <span
                    aria-hidden="true"
                    className="tbe-range-segment"
                    style={{
                      left: trackLeft(startStep / DAY_STEPS),
                      width: `calc((100% - var(--tbe-thumb-w)) * ${(endStep - startStep) / DAY_STEPS})`,
                    }}
                  />
                  {workday ? (
                    <span aria-hidden="true" title="Ahora" className="tbe-range-now" style={{ left: trackLeft(workday.nowFraction) }} />
                  ) : null}
                  <input
                    type="range"
                    className="tbe-range-input"
                    min={0}
                    max={DAY_STEPS}
                    step={1}
                    value={startStep}
                    style={{ zIndex: lastThumb === 'start' ? 3 : 2 }}
                    onChange={(event) => setStartStep(Number(event.target.value))}
                    aria-label={`Inicio de ${workdayTitle.toLowerCase()}`}
                    aria-valuetext={workday?.startLabel}
                  />
                  <input
                    type="range"
                    className="tbe-range-input"
                    min={0}
                    max={DAY_STEPS}
                    step={1}
                    value={endStep}
                    style={{ zIndex: lastThumb === 'end' ? 3 : 2 }}
                    onChange={(event) => setEndStep(Number(event.target.value))}
                    aria-label={`Fin de ${workdayTitle.toLowerCase()}`}
                    aria-valuetext={workday?.endLabel}
                  />
                </div>
                <div aria-hidden="true" className="tbe-range-hours">
                  {HOUR_GRID.map((hour) => (
                    <span key={hour} style={{ left: trackLeft(hour / 24) }}>{String(hour).padStart(2, '0')}</span>
                  ))}
                </div>
              </div>

              <div className="tbe-chip-row">
                <span className="tbe-quick-label">Rápido</span>
                {(workday?.presets ?? []).map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    className={`tbe-chip tbe-chip--preset${preset.active ? ' is-on' : ''}`}
                    aria-pressed={preset.active}
                    onClick={() => updatePlan({
                      dayStartMinutes: preset.startMinutes,
                      dayEndMinutes: preset.endMinutes,
                      ...(preset.workDays ? { workDays: [...preset.workDays] as TaskBoardPlan['workDays'] } : {}),
                    }, 'hrs')}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>

              <div className="tbe-field-block tbe-field-block--wide">
                <span id={`${ids}-days`} className="tbe-label">{workday?.daysTitle ?? 'Días'}</span>
                <div role="group" aria-labelledby={`${ids}-days`} className="tbe-days">
                  {DAYS.map(([short, full], index) => (
                    <button
                      key={full}
                      type="button"
                      aria-pressed={plan.workDays[index]}
                      aria-label={full}
                      className={`tbe-chip tbe-day${plan.workDays[index] ? ' is-on' : ''}`}
                      onClick={() => toggleDay(index)}
                    >
                      {short}
                    </button>
                  ))}
                </div>
              </div>
            </section>

            <section className="tbe-section" aria-labelledby={`${ids}-sprints`} style={{ animationDelay: '240ms' }}>
              <div className="tbe-section-title">
                <h2 id={`${ids}-sprints`} className="tbe-h2">Sprints</h2>
                <span className="tbe-sub">Definen las columnas «Sprint actual» y «Sprint siguiente» del tablero.</span>
              </div>
              <div className="tbe-grid-2">
                <div className="tbe-field-block">
                  <span className="tbe-label">Duración</span>
                  <Stepper
                    bump={bumps.sprint}
                    decLabel="Acortar sprint"
                    incLabel="Alargar sprint"
                    canDec={plan.sprintWeeks > MIN_SPRINT_WEEKS}
                    canInc={plan.sprintWeeks < MAX_SPRINT_WEEKS}
                    onDec={() => updatePlan({ sprintWeeks: plan.sprintWeeks - 1 }, 'sprint')}
                    onInc={() => updatePlan({ sprintWeeks: plan.sprintWeeks + 1 }, 'sprint')}
                  >
                    <span className="tbe-stepper-value">{plan.sprintWeeks}</span>
                    <span className="tbe-stepper-unit">{sprints?.weeksLabel ?? ''}</span>
                  </Stepper>
                  <div className="tbe-quick-row">
                    {SPRINT_QUICK.map((weeks) => (
                      <button
                        key={weeks}
                        type="button"
                        aria-pressed={plan.sprintWeeks === weeks}
                        className={`tbe-chip tbe-chip--quick${plan.sprintWeeks === weeks ? ' is-on' : ''}`}
                        onClick={() => updatePlan({ sprintWeeks: weeks }, 'sprint')}
                      >
                        {weeks} sem
                      </button>
                    ))}
                  </div>
                </div>
                <div className="tbe-field-block">
                  <span id={`${ids}-sday`} className="tbe-label">Empiezan el</span>
                  <div role="radiogroup" aria-labelledby={`${ids}-sday`} className="tbe-quick-row" onKeyDown={handleRadioGroupKeys}>
                    {DAYS.slice(0, 5).map(([short, full], index) => {
                      const checked = plan.sprintStartWeekday === index
                      return (
                        <button
                          key={full}
                          type="button"
                          role="radio"
                          aria-checked={checked}
                          aria-label={full}
                          tabIndex={radioTabIndex(checked, index, plan.sprintStartWeekday <= 4)}
                          className={`tbe-chip tbe-chip--weekday${checked ? ' is-on' : ''}`}
                          onClick={() => updatePlan({ sprintStartWeekday: index }, 'sprint')}
                        >
                          {short}
                        </button>
                      )
                    })}
                  </div>
                  <span className="tbe-hint">{sprints?.yearNote ?? ' '}</span>
                </div>
              </div>
              <div key={`sprints-${bumps.sprint ?? 0}`} className={`tbe-sprint-list${bumps.sprint ? ' tbe-rise' : ''}`}>
                {(sprints?.rows ?? []).map((row) => (
                  <div key={`${row.badgeKind}-${row.number}`} className={`tbe-sprint-row tbe-sprint-row--${row.badgeKind}`}>
                    <span className="tbe-sprint-number">{row.number}</span>
                    <span className="tbe-sprint-text">
                      <span className="tbe-sprint-label">{row.label}</span>
                      <span className="tbe-sprint-range">{row.range}</span>
                    </span>
                    <span className={`tbe-badge tbe-badge--${row.badgeKind}`}>{row.badge}</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="tbe-section tbe-section--last" aria-labelledby={`${ids}-div`} style={{ animationDelay: '320ms' }}>
              <div className="tbe-section-title">
                <h2 id={`${ids}-div`} className="tbe-h2">Divisiones del año</h2>
                <span className="tbe-sub">Definen la columna «Próximo {prefixShown}» y cómo se agrupa el año.</span>
              </div>
              <div className="tbe-grid-div">
                <div className="tbe-field-block tbe-div-count">
                  <span className="tbe-label">Cantidad</span>
                  <Stepper
                    bump={bumps.div}
                    decLabel="Menos divisiones"
                    incLabel="Más divisiones"
                    canDec={plan.divisionsPerYear > MIN_DIVISIONS}
                    canInc={plan.divisionsPerYear < MAX_DIVISIONS}
                    onDec={() => updatePlan({ divisionsPerYear: plan.divisionsPerYear - 1 }, 'div')}
                    onInc={() => updatePlan({ divisionsPerYear: plan.divisionsPerYear + 1 }, 'div')}
                  >
                    <span className="tbe-stepper-value">{plan.divisionsPerYear}</span>
                    <span className="tbe-stepper-unit">{divisions?.unit ?? ''}</span>
                  </Stepper>
                </div>
                <label className="tbe-field-block">
                  <span className="tbe-label">Prefijo</span>
                  <span className="tbe-field tbe-field--38">
                    <input
                      className="tbe-input tbe-input--prefix"
                      value={plan.divisionPrefix}
                      maxLength={PREFIX_MAX_CHARS}
                      onChange={(event) => updatePlan({ divisionPrefix: event.target.value.slice(0, PREFIX_MAX_CHARS) })}
                      aria-label="Prefijo de las divisiones"
                    />
                  </span>
                </label>
                <label className="tbe-field-block">
                  <span className="tbe-label">El año empieza en</span>
                  <span className="tbe-field tbe-field--38 tbe-field--select">
                    <select
                      className="tbe-select"
                      aria-label="Mes de inicio del año"
                      value={plan.yearStartMonth}
                      onChange={(event) => updatePlan({ yearStartMonth: Number(event.target.value) }, 'div')}
                    >
                      {MONTHS.map((month, index) => (
                        <option key={month} value={index + 1}>{month}</option>
                      ))}
                    </select>
                    <span className="tbe-select-chevron"><Icon path={CHEVRON_PATH} size={13} strokeWidth={2.2} /></span>
                  </span>
                </label>
              </div>

              <div className="tbe-chip-row tbe-chip-row--tight">
                {DIVISION_QUICK.map(([count, label]) => (
                  <button
                    key={count}
                    type="button"
                    aria-pressed={plan.divisionsPerYear === count}
                    className={`tbe-chip tbe-chip--quick tbe-chip--division${plan.divisionsPerYear === count ? ' is-on' : ''}`}
                    onClick={() => updatePlan({ divisionsPerYear: count }, 'div')}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="tbe-year">
                <div className="tbe-year-head">
                  <span className="tbe-muted">{divisions?.yearLabel ?? ' '}</span>
                  <span>
                    <span className="tbe-muted">{todayPrefix}</span>
                    <span className="tbe-year-today">{todayLabel.slice(todayPrefix.length)}</span>
                    <span className="tbe-muted">{divisions?.sprintLabel ?? ''}</span>
                  </span>
                </div>
                <div className="tbe-year-track">
                  <div className={`tbe-year-bars ${bumpClass(bumps.div)}`}>
                    {(divisions?.bars ?? []).map((bar, index) => (
                      <span
                        key={`${index}-${bar.label}`}
                        className={`tbe-year-bar${bar.current ? ' is-current' : ''}`}
                        style={{ flexGrow: bar.days }}
                        title={bar.tooltip}
                      >
                        {bar.label}
                      </span>
                    ))}
                  </div>
                  {divisions ? (
                    <div aria-hidden="true" className="tbe-year-marks">
                      {divisions.sprintTicks.map((tick, index) => (
                        <span key={index} className="tbe-year-tick" style={{ left: `${tick * 100}%` }} />
                      ))}
                      <span className="tbe-year-today-label" style={{ left: `${divisions.todayFraction * 100}%` }}>Hoy</span>
                      <span className="tbe-year-today-line" style={{ left: `${divisions.todayFraction * 100}%` }} />
                      <span className="tbe-year-today-dot" style={{ left: `${divisions.todayFraction * 100}%` }} />
                    </div>
                  ) : null}
                </div>
                <div aria-hidden="true" className="tbe-year-months">
                  {(divisions?.months ?? []).map((month, index) => (
                    <span key={`${index}-${month}`}>{month}</span>
                  ))}
                </div>
                <div className="tbe-year-foot">
                  <span>{divisions?.duration ?? ''}</span>
                  <span>{divisions?.sprintsPerDivision ?? ''}</span>
                  <span>{divisions?.current ?? ''}</span>
                </div>
              </div>
            </section>
            {onDelete && !isCreate ? (
              <button type="button" className="tbe-delete" onClick={onDelete}>
                <Icon path={TRASH_PATH} size={16} />
                Eliminar tablero
              </button>
            ) : null}
          </div>

          {previewError ? (
            <p className="tbe-preview-error" role="alert">{previewError}</p>
          ) : null}

          <footer className="tbe-footer">
            <div className="tbe-status" aria-live="polite">
              {saveError ? (
                <span className="tbe-status-error" role="alert">{saveError}</span>
              ) : justSaved ? (
                <span className="tbe-status-saved">
                  <Icon path={CHECK_PATH} strokeWidth={2.6} />
                  Guardado
                </span>
              ) : dirty ? (
                <span className="tbe-status-dirty">
                  <span className="tbe-status-dot" aria-hidden="true" />
                  Cambios sin guardar
                </span>
              ) : null}
            </div>
            <div className="tbe-actions">
              <button type="button" className="tbe-button tbe-button--ghost" onClick={onClose}>
                <span className="tbe-label-wide">Cancelar</span>
                <span className="tbe-label-narrow">Descartar</span>
              </button>
              <button
                type="button"
                className="tbe-button tbe-button--primary"
                disabled={!canSave}
                aria-busy={saving}
                onClick={() => void handleSave()}
              >
                {isCreate ? 'Crear tablero' : 'Guardar cambios'}
              </button>
            </div>
          </footer>
        </div>
      </div>
    </div>
  )
}

interface StepperProps {
  bump: number | undefined
  decLabel: string
  incLabel: string
  canDec: boolean
  canInc: boolean
  onDec: () => void
  onInc: () => void
  children: ReactNode
}

function Stepper({ bump, decLabel, incLabel, canDec, canInc, onDec, onInc, children }: StepperProps) {
  return (
    <div className="tbe-stepper">
      <button type="button" className="tbe-stepper-button" aria-label={decLabel} disabled={!canDec} onClick={onDec}>
        <Icon path={MINUS_PATH} size={13} strokeWidth={2.6} />
      </button>
      <span className={`tbe-stepper-box ${bumpClass(bump)}`}>{children}</span>
      <button type="button" className="tbe-stepper-button" aria-label={incLabel} disabled={!canInc} onClick={onInc}>
        <Icon path={PLUS_PATH} size={13} strokeWidth={2.6} />
      </button>
    </div>
  )
}
