import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { CSSProperties, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import type {
  CpmEdge,
  CpmNetwork,
  CpmRow,
  CpmTable,
  Gantt,
  GanttBar,
  GanttRow,
  ManagementGroupBy,
  ManagementKpi,
  ManagementRangeMode,
  ManagementRequest,
  ManagementView,
  PersonChip,
} from '../../types/managementTypes'
import '../../styles/taskManagement.css'

export interface TaskManagementViewProps {
  view: ManagementView | null
  loading: boolean
  error: string | null
  request: ManagementRequest
  onRequestChange: (next: ManagementRequest) => void
  /** Rust validates (cycles) and recalculates; reject shows the error. */
  onSetPredecessors: (taskPath: string, dependencyPaths: string[]) => Promise<void>
  onOpenTask?: (taskPath: string) => void
  /** False while the person cannot edit (read-only). */
  canEdit: boolean
}

const GROUP_ICONS: Record<ManagementGroupBy, string> = {
  task: 'M4 6h16M4 12h10M4 18h13',
  person: 'M9 8a3 3 0 1 0 0-.01M3.5 19a5.5 5.5 0 0 1 11 0M17 8a2.5 2.5 0 1 0 0-.01M15.5 13.5A4.5 4.5 0 0 1 21 18',
}

const ms = (value: number) => `${value}ms`
const px = (value: number) => `${value}px`

// ---------------------------------------------------------------------------
// Shared highlight: hover with a mouse, tap to toggle on touch.
// ---------------------------------------------------------------------------

interface HighlightHandlers {
  onPointerEnter: (event: ReactPointerEvent) => void
  onPointerLeave: (event: ReactPointerEvent) => void
  onPointerDown: (event: ReactPointerEvent) => void
}

interface Highlight {
  active: string | null
  handlers: (taskPath: string) => HighlightHandlers
  /** Taps toggle the highlight; mouse clicks and keys open the task. */
  activate: (taskPath: string, event: ReactMouseEvent) => void
  /** Taps on a row toggle the highlight; other clicks do nothing. */
  tapRow: (taskPath: string, event: ReactMouseEvent) => void
  clear: () => void
}

function useSharedHighlight(onOpenTask?: (taskPath: string) => void): Highlight {
  const [active, setActive] = useState<string | null>(null)
  const lastPointer = useRef('mouse')

  const handlers = useCallback((taskPath: string): HighlightHandlers => ({
    onPointerEnter: (event) => {
      if (event.pointerType === 'mouse') setActive(taskPath)
    },
    onPointerLeave: (event) => {
      if (event.pointerType === 'mouse') setActive((current) => (current === taskPath ? null : current))
    },
    onPointerDown: (event) => {
      lastPointer.current = event.pointerType
    },
  }), [])

  const toggle = useCallback((taskPath: string) => {
    setActive((current) => (current === taskPath ? null : taskPath))
  }, [])

  const isTap = (event: ReactMouseEvent) => event.detail !== 0 && lastPointer.current !== 'mouse'

  const activate = (taskPath: string, event: ReactMouseEvent) => {
    if (isTap(event)) toggle(taskPath)
    else onOpenTask?.(taskPath)
  }

  const tapRow = (taskPath: string, event: ReactMouseEvent) => {
    if (isTap(event)) toggle(taskPath)
  }

  return { active, handlers, activate, tapRow, clear: () => setActive(null) }
}

// ---------------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------------

function Icon({ path, size = 13, strokeWidth = 2.4 }: { path: string; size?: number; strokeWidth?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <path d={path} />
    </svg>
  )
}

function Avatar({ person, size }: { person: PersonChip; size: 'mini' | 'table' | 'row' }) {
  const style: CSSProperties | undefined = person.color
    ? { color: person.color, background: `color-mix(in srgb, ${person.color} 18%, transparent)` }
    : undefined
  return (
    <span className={`tm-mgmt__avatar tm-mgmt__avatar--${size}`} data-colorless={person.color ? undefined : 'true'}
      title={person.name} style={style}>
      {person.initials}
    </span>
  )
}

function Segmented<T extends string>({ label, options, onPick }: {
  label: string
  options: { value: T; label: string; tooltip?: string; selected: boolean; icon?: string }[]
  onPick: (value: T) => void
}) {
  return (
    <div role="group" aria-label={label} className="tm-mgmt__segmented">
      {options.map((option) => (
        <button key={option.value} type="button" className="tm-mgmt__segment" aria-pressed={option.selected}
          title={option.tooltip} onClick={() => onPick(option.value)}>
          {option.icon ? <Icon path={option.icon} strokeWidth={2.2} /> : null}
          {option.label}
        </button>
      ))}
    </div>
  )
}

function Kpis({ kpis }: { kpis: ManagementKpi[] }) {
  return (
    <div className="tm-mgmt__kpis">
      {kpis.map((kpi, index) => (
        <div key={kpi.kind} className="tm-mgmt__kpi" style={{ animationDelay: ms(index * 60) }}>
          <span className="tm-mgmt__kpi-label">{kpi.label}</span>
          <span className="tm-mgmt__kpi-value" data-tone={kpi.tone} title={kpi.value}>{kpi.value}</span>
          <span className="tm-mgmt__kpi-sub" title={kpi.sub}>{kpi.sub}</span>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Gantt
// ---------------------------------------------------------------------------

interface GanttSectionProps {
  view: ManagementView
  highlight: Highlight
  onChange: (next: Partial<ManagementRequest>) => void
}

function GanttToolbar({ view, titleId, onChange }: Pick<GanttSectionProps, 'view' | 'onChange'> & { titleId: string }) {
  const { divisions, range, gantt } = view
  return (
    <div className="tm-mgmt__toolbar">
      <div className="tm-mgmt__heading">
        <h2 id={titleId} className="tm-mgmt__title">{range.heading}</h2>
        <span className="tm-mgmt__subtitle">{range.subtitle}</span>
      </div>
      <div role="group" aria-label="División del año" className="tm-mgmt__divisions">
        <button type="button" className="tm-mgmt__icon-button" aria-label="División anterior"
          onClick={() => onChange({ divisionOffset: divisions.previousOffset })}>
          <Icon path="M15 6l-6 6 6 6" />
        </button>
        <span className="tm-mgmt__segmented">
          {divisions.tabs.map((tab) => (
            <button key={tab.label} type="button" className="tm-mgmt__segment tm-mgmt__division-tab"
              aria-pressed={tab.selected} title={tab.tooltip} onClick={() => onChange({ divisionOffset: tab.offset })}>
              {tab.label}
              {tab.current ? <span className="tm-mgmt__current-dot"><span className="tm-mgmt__sr">(actual)</span></span> : null}
            </button>
          ))}
        </span>
        <span className="tm-mgmt__fiscal-year">{divisions.fiscalYearLabel}</span>
        <button type="button" className="tm-mgmt__icon-button" aria-label="División siguiente"
          onClick={() => onChange({ divisionOffset: divisions.nextOffset })}>
          <Icon path="M9 6l6 6-6 6" />
        </button>
        {divisions.showToday ? (
          <button type="button" className="tm-mgmt__text-button tm-mgmt__pop" onClick={() => onChange({ divisionOffset: 0 })}>
            Hoy
          </button>
        ) : null}
      </div>
      <span className="tm-mgmt__spacer" />
      <Segmented<ManagementRangeMode>
        label="Rango de tiempo"
        options={range.modes.map((mode) => ({ value: mode.mode, label: mode.label, tooltip: mode.tooltip, selected: mode.selected }))}
        onPick={(rangeMode) => onChange({ rangeMode })}
      />
      <Segmented<ManagementGroupBy>
        label="Agrupar filas"
        options={gantt.groupOptions.map((option) => ({
          value: option.groupBy, label: option.label, selected: option.selected, icon: GROUP_ICONS[option.groupBy],
        }))}
        onPick={(groupBy) => onChange({ groupBy })}
      />
    </div>
  )
}

function GanttLegend() {
  return (
    <div className="tm-mgmt__legend">
      <span><span className="tm-mgmt__swatch tm-mgmt__swatch--critical" />Ruta crítica</span>
      <span><span className="tm-mgmt__swatch tm-mgmt__swatch--slack-bar" />Con holgura</span>
      <span><span className="tm-mgmt__swatch tm-mgmt__swatch--slack" />Holgura</span>
      <span><span className="tm-mgmt__swatch tm-mgmt__swatch--wait" />Espera a la persona</span>
      <span><span className="tm-mgmt__swatch tm-mgmt__swatch--now" />Ahora</span>
    </div>
  )
}

function GanttHeader({ gantt }: { gantt: Gantt }) {
  return (
    <div className="tm-mgmt__gantt-head">
      <span className="tm-mgmt__gantt-corner">
        <span className="tm-mgmt__caps">{gantt.headLabel}</span>
        <span>{gantt.countLabel}</span>
      </span>
      <span className="tm-mgmt__gantt-scale">
        {gantt.months.map((month) => (
          <span key={`${month.x}-${month.label}`} className="tm-mgmt__month" style={{ left: px(month.x), width: px(month.width) }}>
            {month.label}
          </span>
        ))}
        {gantt.sprints.map((sprint) => (
          <span key={sprint.tooltip} className="tm-mgmt__sprint" data-kind={sprint.kind} title={sprint.tooltip}
            style={{ left: px(sprint.x), width: px(sprint.width) }}>
            {sprint.label}
          </span>
        ))}
        {gantt.ticks.map((tick) => (
          <span key={tick.x} className="tm-mgmt__tick" data-today={tick.today || undefined} data-weekend={tick.weekend || undefined}
            style={{ left: px(tick.x), width: px(tick.width) }}>
            <span className="tm-mgmt__tick-top">{tick.top}</span>
            <span>{tick.bottom}</span>
          </span>
        ))}
      </span>
    </div>
  )
}

function BarView({ bar, highlight }: { bar: GanttBar; highlight: Highlight }) {
  const active = highlight.active === bar.taskPath
  const radius = bar.clippedLeft && bar.clippedRight ? 'both' : bar.clippedLeft ? 'left' : bar.clippedRight ? 'right' : undefined
  return (
    <>
      {bar.wait ? (
        <span className="tm-mgmt__wait" title={bar.wait.tooltip}
          style={{ left: px(bar.wait.x), width: px(bar.wait.width), top: px(bar.wait.top), height: px(bar.wait.height) }} />
      ) : null}
      {bar.slack ? (
        <span className="tm-mgmt__slack" title={bar.slack.tooltip}
          style={{ left: px(bar.slack.x), width: px(bar.slack.width), top: px(bar.slack.top), height: px(bar.slack.height) }} />
      ) : null}
      <button type="button" className="tm-mgmt__bar" data-critical={bar.critical || undefined} data-active={active || undefined}
        data-clipped={radius} title={bar.tooltip} aria-label={bar.tooltip}
        style={{ left: px(bar.x), width: px(bar.width), top: px(bar.top), height: px(bar.height), animationDelay: ms(bar.delayMs) }}
        {...highlight.handlers(bar.taskPath)}
        onClick={(event) => {
          event.stopPropagation()
          highlight.activate(bar.taskPath, event)
        }}>
        {bar.clippedLeft ? <Icon path="M15 6l-6 6 6 6" size={10} strokeWidth={3} /> : null}
        {bar.blocked ? (
          <svg aria-hidden="true" className="tm-mgmt__lock" width="11" height="11" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
            <rect x="5" y="11" width="14" height="10" rx="2" />
            <path d="M8 11V8a4 4 0 0 1 8 0v3" />
          </svg>
        ) : null}
        <span className="tm-mgmt__ellipsis">{bar.label}</span>
        {bar.clippedRight ? <span className="tm-mgmt__bar-end"><Icon path="M9 6l6 6-6 6" size={10} strokeWidth={3} /></span> : null}
      </button>
    </>
  )
}

function RowLabel({ row }: { row: GanttRow }) {
  return (
    <span className="tm-mgmt__row-label">
      {row.letter ? <span className="tm-mgmt__badge" data-critical={row.critical || undefined}>{row.letter}</span> : null}
      {row.person ? (
        row.unassigned
          ? <span className="tm-mgmt__avatar tm-mgmt__avatar--row tm-mgmt__avatar--unassigned">?</span>
          : <Avatar person={row.person} size="row" />
      ) : null}
      <span className="tm-mgmt__row-text">
        <span className="tm-mgmt__row-title">{row.title}</span>
        <span className="tm-mgmt__row-sub">
          {row.avatars.length ? (
            <span className="tm-mgmt__mini-avatars">
              {row.avatars.map((person) => <Avatar key={person.name} person={person} size="mini" />)}
            </span>
          ) : null}
          <span className="tm-mgmt__ellipsis">{row.sub}</span>
        </span>
      </span>
    </span>
  )
}

function GanttRowView({ row, highlight }: { row: GanttRow; highlight: Highlight }) {
  const highlighted = highlight.active !== null && row.taskPaths.includes(highlight.active)
  const taskPath = row.kind === 'task' ? row.taskPaths[0] : null
  const rowHandlers = taskPath ? highlight.handlers(taskPath) : undefined
  return (
    <div className="tm-mgmt__gantt-row" data-highlight={highlighted || undefined} style={{ height: px(row.height) }}
      {...rowHandlers} onClick={taskPath ? (event) => highlight.tapRow(taskPath, event) : undefined}>
      <RowLabel row={row} />
      <span className="tm-mgmt__row-track">
        {row.bars.map((bar) => <BarView key={bar.taskPath} bar={bar} highlight={highlight} />)}
      </span>
    </div>
  )
}

function GanttSection({ view, highlight, onChange }: GanttSectionProps) {
  const { gantt } = view
  const titleId = useId()
  const chartStyle = { '--tm-mgmt-gantt-width': px(gantt.width) } as CSSProperties
  return (
    <section aria-labelledby={titleId} className="tm-mgmt__panel">
      <GanttToolbar view={view} titleId={titleId} onChange={onChange} />
      <GanttLegend />
      <div className="tm-mgmt__scroll tm-mgmt__gantt-scroll">
        <div className="tm-mgmt__gantt" style={chartStyle}>
          <GanttHeader gantt={gantt} />
          <div className="tm-mgmt__gantt-body">
            <div aria-hidden="true" className="tm-mgmt__gantt-layers">
              {gantt.weekends.map((span) => (
                <span key={span.x} className="tm-mgmt__weekend" style={{ left: px(span.x), width: px(span.width) }} />
              ))}
              {gantt.sprintLines.map((x) => <span key={x} className="tm-mgmt__sprint-line" style={{ left: px(x) }} />)}
              {gantt.nowX !== null ? <span className="tm-mgmt__now" style={{ left: px(gantt.nowX) }} /> : null}
            </div>
            {gantt.rows.map((row) => <GanttRowView key={row.key} row={row} highlight={highlight} />)}
            {gantt.rows.length === 0 ? (
              <div className="tm-mgmt__gantt-row tm-mgmt__gantt-empty tm-mgmt__pop">
                <span className="tm-mgmt__row-label" />
                <span className="tm-mgmt__gantt-empty-text">{gantt.noRowsLabel}</span>
              </div>
            ) : null}
          </div>
        </div>
      </div>
      {gantt.outside ? (
        <div className="tm-mgmt__outside">
          <Icon path="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 8v4M12 16v.01" size={14} strokeWidth={2} />
          <span>{gantt.outside.text}</span>
          {gantt.outside.laterLabel ? (
            <button type="button" className="tm-mgmt__text-button" onClick={() => onChange({ divisionOffset: gantt.outside?.nextOffset ?? 0 })}>
              {gantt.outside.laterLabel}
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

// ---------------------------------------------------------------------------
// CPM network
// ---------------------------------------------------------------------------

const EDGE_TONES = ['critical', 'resource', 'active', 'normal'] as const

function edgeTone(edge: CpmEdge, active: string | null): (typeof EDGE_TONES)[number] {
  if (edge.critical) return 'critical'
  if (edge.kind === 'resource') return 'resource'
  if (active !== null && (edge.from === active || edge.to === active)) return 'active'
  return 'normal'
}

function NetworkSection({ network, criticalPath, highlight }: { network: CpmNetwork; criticalPath: string; highlight: Highlight }) {
  const titleId = useId()
  const arrowId = `tm-mgmt-arrow${titleId.replace(/[^a-zA-Z0-9_-]/g, '')}`
  return (
    <section aria-labelledby={titleId} className="tm-mgmt__panel">
      <div className="tm-mgmt__section-head">
        <h2 id={titleId} className="tm-mgmt__title">Red CPM</h2>
        <span className="tm-mgmt__muted">Ruta crítica: <span className="tm-mgmt__critical-text">{criticalPath}</span></span>
        <span className="tm-mgmt__net-legend">
          <span><svg aria-hidden="true" width="22" height="6"><path d="M1 3H21" className="tm-mgmt__legend-line" /></svg>Dependencia</span>
          <span><svg aria-hidden="true" width="22" height="6"><path d="M1 3H21" className="tm-mgmt__legend-line tm-mgmt__legend-line--resource" /></svg>Misma persona</span>
          <span>Valores en horas hábiles</span>
        </span>
        <span className="tm-mgmt__spacer" />
        <span aria-hidden="true" className="tm-mgmt__anatomy">
          <span>ES</span><span>Dur.</span><span>EF</span>
          <span className="tm-mgmt__anatomy-task">Tarea</span>
          <span>LS</span><span>Holg.</span><span>LF</span>
        </span>
      </div>
      <div className="tm-mgmt__scroll tm-mgmt__net-scroll">
        <div className="tm-mgmt__net" style={{ width: px(network.width), height: px(network.height) }}>
          <svg aria-hidden="true" className="tm-mgmt__edges" width={network.width} height={network.height}>
            <defs>
              {EDGE_TONES.map((tone) => (
                <marker key={tone} id={`${arrowId}-${tone}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7"
                  markerHeight="7" orient="auto-start-reverse">
                  <path d="M0 0L10 5L0 10z" className={`tm-mgmt__arrow tm-mgmt__arrow--${tone}`} />
                </marker>
              ))}
            </defs>
            {network.edges.map((edge) => {
              const tone = edgeTone(edge, highlight.active)
              return (
                <path key={edge.key} d={edge.d} pathLength={1} fill="none" strokeLinecap="round"
                  className={`tm-mgmt__edge tm-mgmt__edge--${edge.kind} tm-mgmt__edge--${tone}`}
                  markerEnd={`url(#${arrowId}-${tone})`} style={{ animationDelay: ms(edge.delayMs) }} />
              )
            })}
          </svg>
          {[network.start, network.finish].map((endpoint) => endpoint ? (
            <span key={endpoint.label} className="tm-mgmt__endpoint"
              style={{ left: px(endpoint.x), top: px(endpoint.y), width: px(network.endpointSize), height: px(network.endpointSize), animationDelay: ms(endpoint.delayMs) }}>
              {endpoint.label}
            </span>
          ) : null)}
          {network.nodes.map((node) => (
            <button key={node.taskPath} type="button" className="tm-mgmt__node" data-critical={node.critical || undefined}
              data-active={highlight.active === node.taskPath || undefined} title={node.tooltip}
              aria-label={`${node.letter} · ${node.tooltip}`}
              style={{ left: px(node.x), top: px(node.y), width: px(network.nodeWidth), height: px(network.nodeHeight), animationDelay: ms(node.delayMs) }}
              {...highlight.handlers(node.taskPath)}
              onClick={(event) => highlight.activate(node.taskPath, event)}>
              <span className="tm-mgmt__node-head">
                <span>{node.earlyStart}</span>
                <span data-unestimated={node.unestimated || undefined}>{node.duration}</span>
                <span>{node.earlyFinish}</span>
              </span>
              <span className="tm-mgmt__node-body">
                <span className="tm-mgmt__badge tm-mgmt__badge--small" data-critical={node.critical || undefined}>{node.letter}</span>
                <span className="tm-mgmt__node-title">{node.title}</span>
              </span>
              <span className="tm-mgmt__node-foot">
                <span>{node.lateStart}</span>
                <span className="tm-mgmt__node-slack">{node.slack}</span>
                <span>{node.lateFinish}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// CPM table and predecessor popover
// ---------------------------------------------------------------------------

interface PopoverPlace {
  left: number
  top?: number
  bottom?: number
}

interface PredecessorPopoverProps {
  row: CpmRow
  table: CpmTable
  place: PopoverPlace
  canEdit: boolean
  onToggle: (row: CpmRow, candidatePath: string, checked: boolean) => Promise<void>
  onClose: () => void
}

function PredecessorPopover({ row, table, place, canEdit, onToggle, onClose }: PredecessorPopoverProps) {
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const options = table.candidates.filter((candidate) => candidate.taskPath !== row.taskPath)

  useEffect(() => {
    const first = listRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')
    first?.focus()
  }, [])

  const toggle = async (candidatePath: string, checked: boolean) => {
    setPending(true)
    setFailure(null)
    try {
      await onToggle(row, candidatePath, checked)
    } catch (reason) {
      setFailure(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setPending(false)
    }
  }

  return (
    <div role="dialog" aria-label={row.popoverLabel} className="tm-mgmt__popover"
      style={{ left: px(place.left), top: place.top === undefined ? undefined : px(place.top), bottom: place.bottom === undefined ? undefined : px(place.bottom) }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          onClose()
        }
      }}>
      <span className="tm-mgmt__popover-title">{row.popoverTitle}</span>
      <div ref={listRef} className="tm-mgmt__scroll tm-mgmt__popover-list" aria-busy={pending || undefined}>
        {options.map((option) => {
          const checked = row.predecessors.includes(option.letter)
          const cycle = !checked && row.cycleLetters.includes(option.letter)
          return (
            <button key={option.taskPath} type="button" aria-pressed={checked}
              className="tm-mgmt__option" disabled={cycle || pending || !canEdit}
              data-cycle={cycle || undefined} onClick={() => void toggle(option.taskPath, checked)}>
              <span className="tm-mgmt__checkbox" data-checked={checked || undefined}>
                {checked ? <Icon path="M5 12.5l4.5 4.5L19 7.5" size={11} strokeWidth={3.4} /> : null}
              </span>
              <span className="tm-mgmt__badge tm-mgmt__badge--small">{option.letter}</span>
              <span className="tm-mgmt__option-text">
                <span className="tm-mgmt__ellipsis">{option.title}</span>
                {cycle ? <span className="tm-mgmt__cycle-note">{table.cycleNote}</span> : null}
              </span>
            </button>
          )
        })}
      </div>
      {failure ? <span role="alert" className="tm-mgmt__popover-error">{failure}</span> : null}
      <div className="tm-mgmt__popover-foot">
        <button type="button" className="tm-mgmt__primary" onClick={onClose}>Listo</button>
      </div>
    </div>
  )
}

interface TableSectionProps {
  table: CpmTable
  highlight: Highlight
  canEdit: boolean
  onOpenTask?: (taskPath: string) => void
  onSetPredecessors: (taskPath: string, dependencyPaths: string[]) => Promise<void>
}

function CpmTableRow({ row, highlight, canEdit, open, onOpenTask, onEdit }: {
  row: CpmRow
  highlight: Highlight
  canEdit: boolean
  open: boolean
  onOpenTask?: (taskPath: string) => void
  onEdit: (row: CpmRow, button: HTMLButtonElement) => void
}) {
  return (
    <tr className="tm-mgmt__trow" data-highlight={highlight.active === row.taskPath || undefined}
      style={{ animationDelay: ms(row.delayMs) }} {...highlight.handlers(row.taskPath)}
      onClick={(event) => highlight.tapRow(row.taskPath, event)}>
      <td className="tm-mgmt__cell-id"><span className="tm-mgmt__badge" data-critical={row.critical || undefined}>{row.letter}</span></td>
      <td>
        <span className="tm-mgmt__task-cell">
          {onOpenTask ? (
            <button type="button" className="tm-mgmt__link" onClick={(event) => { event.stopPropagation(); onOpenTask(row.taskPath) }}>
              {row.title}
            </button>
          ) : <span className="tm-mgmt__task-title">{row.title}</span>}
          <span className="tm-mgmt__task-group">
            <span className="tm-mgmt__dot" style={{ background: row.groupColor }} />
            {row.group}
            {row.unestimatedNote ? <span className="tm-mgmt__warn">· {row.unestimatedNote}</span> : null}
          </span>
        </span>
      </td>
      <td>
        <span className="tm-mgmt__table-avatars">
          {row.people.map((person) => <Avatar key={person.name} person={person} size="table" />)}
          {row.unassignedLabel ? <span className="tm-mgmt__warn">{row.unassignedLabel}</span> : null}
        </span>
      </td>
      <td className="tm-mgmt__num tm-mgmt__strong">{row.remaining}</td>
      <td>
        <span className="tm-mgmt__preds">
          {row.predecessors.map((letter) => <span key={letter} className="tm-mgmt__pred tm-mgmt__pop">{letter}</span>)}
          {row.predecessors.length === 0 ? <span className="tm-mgmt__muted">Inicio</span> : null}
          {canEdit ? (
            <button type="button" className="tm-mgmt__icon-button tm-mgmt__reveal" aria-label={row.editLabel}
              aria-expanded={open} aria-haspopup="dialog"
              onClick={(event) => { event.stopPropagation(); onEdit(row, event.currentTarget) }}>
              <Icon path="M4 20h4L19 9l-4-4L4 16z" size={12} strokeWidth={2.2} />
            </button>
          ) : null}
        </span>
      </td>
      <td>
        <span className="tm-mgmt__stack">
          <span>{row.startLabel}</span>
          {row.waitLabel ? <span className="tm-mgmt__wait-text">{row.waitLabel}</span> : null}
        </span>
      </td>
      <td>{row.endLabel}</td>
      <td className="tm-mgmt__muted">{row.lateStartLabel}</td>
      <td className="tm-mgmt__num tm-mgmt__strong tm-mgmt__slack-value" data-critical={row.critical || undefined}>{row.slackLabel}</td>
      <td className="tm-mgmt__cell-route">
        <span className="tm-mgmt__route" data-critical={row.critical || undefined}>{row.routeLabel}</span>
      </td>
    </tr>
  )
}

function TableSection({ table, highlight, canEdit, onOpenTask, onSetPredecessors }: TableSectionProps) {
  const titleId = useId()
  const sectionRef = useRef<HTMLElement>(null)
  const anchorRef = useRef<HTMLButtonElement | null>(null)
  const [openPath, setOpenPath] = useState<string | null>(null)
  const [place, setPlace] = useState<PopoverPlace | null>(null)
  const openRow = table.rows.find((row) => row.taskPath === openPath) ?? null

  const measure = useCallback((row: CpmRow, button: HTMLButtonElement) => {
    const section = sectionRef.current
    const cell = button.closest('td')
    if (!section || !cell) return
    const box = section.getBoundingClientRect()
    const anchor = cell.getBoundingClientRect()
    const left = Math.max(8, Math.min(anchor.left - box.left + 6, box.width - 288))
    setPlace(row.popoverAbove
      ? { left, bottom: box.bottom - anchor.top - 4 }
      : { left, top: anchor.bottom - box.top - 4 })
  }, [])

  const close = useCallback(() => {
    setOpenPath(null)
    anchorRef.current?.focus()
  }, [])

  const edit = (row: CpmRow, button: HTMLButtonElement) => {
    if (openPath === row.taskPath) {
      setOpenPath(null)
      return
    }
    anchorRef.current = button
    measure(row, button)
    setOpenPath(row.taskPath)
  }

  useEffect(() => {
    if (!openRow) return
    const reposition = () => {
      if (anchorRef.current?.isConnected) measure(openRow, anchorRef.current)
    }
    const dismiss = (event: PointerEvent) => {
      const target = event.target as Node | null
      const popover = sectionRef.current?.querySelector('.tm-mgmt__popover')
      if (target && (popover?.contains(target) || anchorRef.current?.contains(target))) return
      setOpenPath(null)
    }
    window.addEventListener('resize', reposition)
    document.addEventListener('pointerdown', dismiss)
    return () => {
      window.removeEventListener('resize', reposition)
      document.removeEventListener('pointerdown', dismiss)
    }
  }, [openRow, measure])

  const toggle = async (row: CpmRow, candidatePath: string, checked: boolean) => {
    const next = checked
      ? row.dependencyPaths.filter((path) => path !== candidatePath)
      : [...row.dependencyPaths, candidatePath]
    await onSetPredecessors(row.taskPath, next)
  }

  return (
    <section ref={sectionRef} aria-labelledby={titleId} className="tm-mgmt__panel tm-mgmt__panel--table">
      <div className="tm-mgmt__section-head">
        <h2 id={titleId} className="tm-mgmt__title">Tabla CPM</h2>
        <span className="tm-mgmt__muted">{table.description}</span>
      </div>
      <div className="tm-mgmt__scroll tm-mgmt__table-scroll"
        onScroll={() => { if (openRow && anchorRef.current) measure(openRow, anchorRef.current) }}>
        <table className="tm-mgmt__table">
          <thead>
            <tr>
              <th scope="col" className="tm-mgmt__col-id">ID</th>
              <th scope="col">Tarea</th>
              <th scope="col" className="tm-mgmt__col-people">Personas</th>
              <th scope="col" className="tm-mgmt__col-remaining tm-mgmt__num">Restante</th>
              <th scope="col" className="tm-mgmt__col-preds">Predecesoras</th>
              <th scope="col" className="tm-mgmt__col-start">Inicio</th>
              <th scope="col" className="tm-mgmt__col-date">Fin</th>
              <th scope="col" className="tm-mgmt__col-date">Inicio tardío</th>
              <th scope="col" className="tm-mgmt__col-slack tm-mgmt__num">Holgura</th>
              <th scope="col" className="tm-mgmt__col-route">Ruta</th>
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row) => (
              <CpmTableRow key={row.taskPath} row={row} highlight={highlight} canEdit={canEdit}
                open={openPath === row.taskPath} onOpenTask={onOpenTask} onEdit={edit} />
            ))}
          </tbody>
        </table>
      </div>
      {openRow && place ? (
        <PredecessorPopover key={openRow.taskPath} row={openRow} table={table} place={place} canEdit={canEdit}
          onToggle={toggle} onClose={close} />
      ) : null}
    </section>
  )
}

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

function Shell({ busy, children }: { busy: boolean; children: ReactNode }) {
  return <div className="tm-mgmt" aria-busy={busy || undefined}>{children}</div>
}

export function TaskManagementView({
  view,
  loading,
  error,
  request,
  onRequestChange,
  onSetPredecessors,
  onOpenTask,
  canEdit,
}: TaskManagementViewProps) {
  const highlight = useSharedHighlight(onOpenTask)
  const errorBanner = error ? <div role="alert" className="tm-mgmt__error">{error}</div> : null

  if (!view) {
    return (
      <Shell busy={loading}>
        {errorBanner}
        {loading ? <div role="status" className="tm-mgmt__state">Calculando el plan…</div> : null}
      </Shell>
    )
  }

  const change = (next: Partial<ManagementRequest>) => {
    if (next.divisionOffset !== undefined && next.divisionOffset !== request.divisionOffset) highlight.clear()
    onRequestChange({ ...request, ...next })
  }

  return (
    <Shell busy={loading}>
      {errorBanner}
      {loading ? <span role="status" className="tm-mgmt__sr">Recalculando el plan…</span> : null}
      <Kpis kpis={view.kpis} />
      {view.empty ? (
        <div className="tm-mgmt__empty tm-mgmt__pop">{view.emptyLabel}</div>
      ) : (
        <>
          <GanttSection view={view} highlight={highlight} onChange={change} />
          <NetworkSection network={view.network} criticalPath={view.criticalPath} highlight={highlight} />
          <TableSection table={view.table} highlight={highlight} canEdit={canEdit} onOpenTask={onOpenTask}
            onSetPredecessors={onSetPredecessors} />
        </>
      )}
    </Shell>
  )
}
