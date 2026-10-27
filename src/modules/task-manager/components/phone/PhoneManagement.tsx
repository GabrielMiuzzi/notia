import { useState, type ReactNode } from 'react'
import type { CpmNode, GanttBar, ManagementRequest, ManagementView, ManagementTone, PersonChip } from '../../types/managementTypes'
import { PhoneIcon } from './phoneIcons'

interface PhoneManagementProps {
  view: ManagementView | null
  loading: boolean
  error: string | null
  request: ManagementRequest
  onRequestChange: (request: ManagementRequest) => void
  onOpenTask: (taskPath: string) => void
  renderHeader: (extra: ReactNode) => ReactNode
}

/** Height of a Gantt row and its bar on the phone. */
const ROW_HEIGHT = 48
const BAR_TOP = 12
const BAR_HEIGHT = 24
const LEFT_WIDTH = 112

function toneClass(tone: ManagementTone): string {
  return `is-${tone}`
}

function Avatars({ people }: { people: PersonChip[] }) {
  return (
    <span className="tmp-avatars">
      {people.slice(0, 3).map((person) => (
        <span key={person.name} className="tmp-avatar" title={person.name} style={{ width: 22, height: 22, ['--tmp-person' as string]: person.color ?? 'var(--tm-muted)' }}>
          {person.initials}
        </span>
      ))}
    </span>
  )
}

/** «Mobile · Management»: the plan of the board, as Rust computes it. */
export function PhoneManagement({ view, loading, error, request, onRequestChange, onOpenTask, renderHeader }: PhoneManagementProps) {
  const [openRow, setOpenRow] = useState<string | null>(null)
  const divisions = view?.divisions
  const go = (divisionOffset: number) => onRequestChange({ ...request, divisionOffset })

  const divisionRow = divisions ? (
    <div className="tmp-division-row">
      <button type="button" className="tmp-icon-btn tmp-division-nav" aria-label="División anterior" onClick={() => go(divisions.previousOffset)}>
        <PhoneIcon name="chevronLeft" size={14} strokeWidth={2.4} />
      </button>
      <div className="tmp-segment tmp-segment--grow" role="group" aria-label="División del año">
        {divisions.tabs.map((tab) => (
          <button
            key={tab.offset}
            type="button"
            className={`tmp-segment-btn tmp-segment-btn--display${tab.selected ? ' is-on' : ''}`}
            aria-pressed={tab.selected}
            title={tab.tooltip}
            onClick={() => go(tab.offset)}
          >
            {tab.label}
            {tab.current ? <span className="tmp-now-dot" aria-label="Hoy" /> : null}
          </button>
        ))}
      </div>
      <button type="button" className="tmp-icon-btn tmp-division-nav" aria-label="División siguiente" onClick={() => go(divisions.nextOffset)}>
        <PhoneIcon name="chevronRight" size={14} strokeWidth={2.4} />
      </button>
    </div>
  ) : null

  return (
    <div className="tmp-screen">
      {renderHeader(divisionRow)}
      <main className="tmp-main tmp-main--management" aria-busy={loading}>
        {error ? <div className="tmp-empty" role="alert"><strong>No se pudo armar el plan</strong><span>{error}</span></div> : null}
        {!view && !error ? <div className="tmp-empty" role="status"><span>Armando el plan…</span></div> : null}
        {view && view.empty ? <div className="tmp-empty"><strong>{view.emptyLabel}</strong></div> : null}
        {view && !view.empty ? (
          <>
            <div className="tmp-sec tmp-mgmt-title">
              <span className="tmp-muted tmp-small">
                Año {view.divisions.fiscalYearLabel}
                {view.divisions.showToday ? <> · <button type="button" className="tmp-link" onClick={() => go(0)}>volver a hoy</button></> : null}
              </span>
              <h1>{view.range.title}</h1>
              <span className="tmp-muted tmp-small">{view.range.subtitle}</span>
            </div>
            <div className="tmp-segment tmp-sec" role="group" aria-label="Rango">
              {view.range.modes.map((mode) => (
                <button
                  key={mode.mode}
                  type="button"
                  className={`tmp-segment-btn${mode.selected ? ' is-on' : ''}`}
                  aria-pressed={mode.selected}
                  title={mode.tooltip}
                  onClick={() => onRequestChange({ ...request, rangeMode: mode.mode })}
                >
                  {mode.shortLabel}
                </button>
              ))}
            </div>
            <div className="tmp-kpis">
              {view.kpis.map((kpi, index) => (
                <div key={kpi.kind} className="tmp-kpi tmp-sec" style={{ animationDelay: `${60 + index * 40}ms` }}>
                  <span className="tmp-kpi-label">{kpi.label}</span>
                  <span className={`tmp-kpi-value ${toneClass(kpi.tone)}`}>{kpi.value}</span>
                  <span className="tmp-kpi-sub">{kpi.sub}</span>
                </div>
              ))}
            </div>
            <PhoneGantt view={view} request={request} onRequestChange={onRequestChange} onOpenTask={onOpenTask} onNext={() => go(view.divisions.nextOffset)} />
            <section className="tmp-panel tmp-sec" aria-labelledby="tmp-cp-title" style={{ animationDelay: '260ms' }}>
              <div className="tmp-cp-head">
                <h2 id="tmp-cp-title" className="tmp-panel-title">Ruta crítica</h2>
                <span className="tmp-muted tmp-small">Si una de estas se atrasa, se atrasa el fin. <strong className="tmp-critical-text">{view.criticalPath}</strong></span>
              </div>
              <div className="tmp-chain">
                {view.criticalChain.map((step, index) => (
                  <div key={step.taskPath} className="tmp-chain-step" style={{ animationDelay: `${300 + index * 90}ms` }}>
                    <span className="tmp-chain-rail">
                      <span className="tmp-letter tmp-letter--critical">{step.letter}</span>
                      {step.link ? <span className={`tmp-chain-line${step.linkKind === 'resource' ? ' is-resource' : ''}`} /> : null}
                    </span>
                    <button type="button" className="tmp-chain-text" onClick={() => onOpenTask(step.taskPath)}>
                      <span className="tmp-chain-title">{step.title}</span>
                      <span className="tmp-muted tmp-small tmp-tabular">{step.when}</span>
                      {step.link ? <span className={`tmp-chain-link${step.linkKind === 'resource' ? ' is-resource' : ''}`}>{step.link}</span> : null}
                    </button>
                  </div>
                ))}
                {view.criticalChain.length === 0 ? <span className="tmp-muted tmp-small">Sin tareas críticas en el rango.</span> : null}
              </div>
            </section>
            <section className="tmp-sec tmp-range-tasks" aria-labelledby="tmp-rt-title" style={{ animationDelay: '320ms' }}>
              <div className="tmp-range-tasks-head">
                <h2 id="tmp-rt-title" className="tmp-panel-title">Tareas en el rango</h2>
                <span className="tmp-muted tmp-small">Tocá una para ver el CPM</span>
              </div>
              {view.table.rows.map((row) => {
                const node: CpmNode | undefined = view.network.nodes.find((item) => item.taskPath === row.taskPath)
                const open = openRow === row.taskPath
                return (
                  <div key={row.taskPath} className={`tmp-task-card${row.critical ? ' is-critical' : ''}`}>
                    <button type="button" className="tmp-task-card-head" aria-expanded={open} onClick={() => setOpenRow(open ? null : row.taskPath)}>
                      <span className={`tmp-letter${row.critical ? ' tmp-letter--critical' : ''}`}>{row.letter}</span>
                      <span className="tmp-task-card-text">
                        <span className="tmp-task-card-title">{row.title}</span>
                        <span className="tmp-muted tmp-small tmp-tabular">{row.startLabel} → {row.endLabel}</span>
                      </span>
                      <span className={`tmp-route${row.critical ? ' is-critical' : ''}`}>{row.critical ? row.routeLabel : `${row.slackLabel} libres`}</span>
                    </button>
                    <div className="tmp-task-card-meta">
                      <Avatars people={row.people} />
                      <span className="tmp-tabular">{row.remaining} restantes</span>
                      {row.predecessors.length ? <span>después de <strong>{row.predecessors.join(', ')}</strong></span> : null}
                      {row.waitLabel ? <span className="tmp-wait">{row.waitLabel}</span> : null}
                    </div>
                    {open && node ? (
                      <>
                        <div className="tmp-cpm-grid tmp-pop">
                          <span><small>ES</small><strong>{node.earlyStart}</strong></span>
                          <span><small>Dur.</small><strong>{node.duration}</strong></span>
                          <span><small>EF</small><strong>{node.earlyFinish}</strong></span>
                          <span><small>LS</small><em>{node.lateStart}</em></span>
                          <span><small>Holgura</small><strong className={node.critical ? 'is-coral' : 'is-teal'}>{node.slack}</strong></span>
                          <span><small>LF</small><em>{node.lateFinish}</em></span>
                        </div>
                        <span className="tmp-muted tmp-small tmp-cpm-note">Valores en horas hábiles desde el inicio · jornada de {view.hoursPerDay} h</span>
                        <button type="button" className="tmp-link tmp-cpm-open" onClick={() => onOpenTask(row.taskPath)}>Ver la tarea</button>
                      </>
                    ) : null}
                  </div>
                )
              })}
            </section>
          </>
        ) : null}
      </main>
    </div>
  )
}

function PhoneGantt({
  view,
  request,
  onRequestChange,
  onOpenTask,
  onNext,
}: {
  view: ManagementView
  request: ManagementRequest
  onRequestChange: (request: ManagementRequest) => void
  onOpenTask: (taskPath: string) => void
  onNext: () => void
}) {
  const gantt = view.gantt
  const width = gantt.width
  return (
    <section className="tmp-panel tmp-panel--flush tmp-sec" aria-labelledby="tmp-gantt-title" style={{ animationDelay: '200ms' }}>
      <div className="tmp-gantt-head">
        <h2 id="tmp-gantt-title" className="tmp-panel-title tmp-grow">Gantt</h2>
        <div className="tmp-segment tmp-segment--sm" role="group" aria-label="Agrupar">
          {gantt.groupOptions.map((option) => (
            <button
              key={option.groupBy}
              type="button"
              className={`tmp-segment-btn${option.selected ? ' is-on' : ''}`}
              aria-pressed={option.selected}
              onClick={() => onRequestChange({ ...request, groupBy: option.groupBy })}
            >
              {option.groupBy === 'task' ? 'Tareas' : 'Personas'}
            </button>
          ))}
        </div>
      </div>
      <div className="tmp-gantt-legend">
        <span><i className="tmp-legend-critical" />Crítica</span>
        <span><i className="tmp-legend-slack" />Con holgura</span>
        <span><i className="tmp-legend-wait" />Espera</span>
        <span><i className="tmp-legend-now" />Ahora</span>
      </div>
      <div className="tmp-gantt-scroll">
        <div className="tmp-gantt" style={{ width: LEFT_WIDTH + width }}>
          <div className="tmp-gantt-top">
            <span className="tmp-gantt-corner">{gantt.headLabel}</span>
            <span className="tmp-gantt-scale" style={{ width }}>
              {gantt.months.map((month) => <span key={`${month.x}-${month.label}`} className="tmp-gantt-month" style={{ left: month.x, width: month.width }}>{month.label}</span>)}
              {gantt.sprints.map((sprint) => <span key={`${sprint.x}-${sprint.label}`} className={`tmp-gantt-sprint is-${sprint.kind}`} title={sprint.tooltip} style={{ left: sprint.x, width: sprint.width }}>{sprint.label}</span>)}
              {gantt.ticks.map((tick) => (
                <span key={tick.x} className={`tmp-gantt-tick${tick.today ? ' is-today' : ''}`} style={{ left: tick.x, width: tick.width }}>
                  <strong>{tick.top}</strong>
                  <span>{tick.bottom}</span>
                </span>
              ))}
            </span>
          </div>
          <div className="tmp-gantt-body">
            <div className="tmp-gantt-overlay" aria-hidden="true" style={{ left: LEFT_WIDTH, width }}>
              {gantt.weekends.map((span) => <span key={span.x} className="tmp-gantt-weekend" style={{ left: span.x, width: span.width }} />)}
              {gantt.sprintLines.map((x) => <span key={x} className="tmp-gantt-line" style={{ left: x }} />)}
              {gantt.nowX !== null ? <span className="tmp-gantt-now" style={{ left: gantt.nowX }} /> : null}
            </div>
            {gantt.rows.map((row) => (
              <div key={row.key} className={`tmp-gantt-row${row.critical ? ' is-critical' : ''}`} style={{ height: ROW_HEIGHT }}>
                <button type="button" className="tmp-gantt-label" onClick={() => { if (row.taskPaths[0]) onOpenTask(row.taskPaths[0]) }}>
                  {row.kind === 'task' ? (
                    <span className={`tmp-letter tmp-letter--sm${row.critical ? ' tmp-letter--critical' : ''}`}>{row.letter}</span>
                  ) : (
                    <span className="tmp-avatar" style={{ width: 24, height: 24, ['--tmp-person' as string]: row.person?.color ?? 'var(--tm-muted)' }}>{row.person?.initials ?? '?'}</span>
                  )}
                  <span className="tmp-gantt-label-text">
                    <span>{row.title}</span>
                    <small>{row.sub}</small>
                  </span>
                </button>
                <span className="tmp-gantt-track" style={{ width }}>
                  {row.bars.map((bar: GanttBar) => (
                    <span key={bar.taskPath}>
                      {bar.wait ? <span className="tmp-gantt-wait" title={bar.wait.tooltip} style={{ left: bar.wait.x, width: bar.wait.width, top: BAR_TOP, height: BAR_HEIGHT }} /> : null}
                      <button
                        type="button"
                        className={`tmp-gantt-bar${bar.critical ? ' is-critical' : ''}${bar.blocked ? ' is-blocked' : ''}${bar.clippedLeft ? ' is-clipped-left' : ''}${bar.clippedRight ? ' is-clipped-right' : ''}`}
                        aria-label={bar.tooltip}
                        title={bar.tooltip}
                        style={{ left: bar.x, width: bar.width, top: BAR_TOP, height: BAR_HEIGHT, animationDelay: `${bar.delayMs}ms` }}
                        onClick={() => onOpenTask(bar.taskPath)}
                      >
                        {bar.label}
                      </button>
                    </span>
                  ))}
                </span>
              </div>
            ))}
            {gantt.rows.length === 0 ? <div className="tmp-gantt-empty">{gantt.noRowsLabel}</div> : null}
          </div>
        </div>
      </div>
      {gantt.outside ? (
        <div className="tmp-gantt-outside">
          <span className="tmp-grow">{gantt.outside.text}</span>
          {gantt.outside.laterLabel ? <button type="button" className="tmp-btn tmp-btn--outline tmp-btn--xs tmp-accent-text" onClick={onNext}>{gantt.outside.laterLabel}</button> : null}
        </div>
      ) : null}
    </section>
  )
}
