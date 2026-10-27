import { useMemo, useState } from 'react'
import type { TaskArchiveRow } from '../../types/taskBoardTypes'
import { filterArchiveRows, NO_TASK_FILTERS } from '../../utils/taskFilters'
import { priorityTone } from '../card/taskDisplay'
import { PhoneSheet } from './PhoneSheet'
import { KebabIcon, PhoneIcon } from './phoneIcons'

type ArchiveKind = 'finished' | 'cancelled'

interface PhoneArchiveProps {
  boardName: string
  finished: TaskArchiveRow[]
  cancelled: TaskArchiveRow[]
  onRestore: (taskPath: string) => void
  onDelete: (taskPath: string) => void
}

const PAGE = 20

/** «Mobile · Completadas y Canceladas»: the archive of the board. */
export function PhoneArchive({ boardName, finished, cancelled, onRestore, onDelete }: PhoneArchiveProps) {
  const [kind, setKind] = useState<ArchiveKind>('finished')
  const [query, setQuery] = useState('')
  const [shown, setShown] = useState(PAGE)
  const [selected, setSelected] = useState<TaskArchiveRow | null>(null)
  const all = kind === 'finished' ? finished : cancelled
  const rows = useMemo(() => filterArchiveRows(all, { ...NO_TASK_FILTERS, query }), [all, query])
  const visible = rows.slice(0, shown)
  const tabs: Array<{ id: ArchiveKind; label: string; count: number; icon: 'check' | 'cancel' }> = [
    { id: 'finished', label: 'Completadas', count: finished.length, icon: 'check' },
    { id: 'cancelled', label: 'Canceladas', count: cancelled.length, icon: 'cancel' },
  ]

  return (
    <div className="tmp-screen">
      <header className="tmp-header tmp-header--plain">
        <div className="tmp-title-row">
          <h1 className="tmp-screen-title">Archivo</h1>
          <span className="tmp-muted tmp-small">tablero {boardName}</span>
        </div>
        <div className="tmp-segment tmp-segment--lg" role="tablist" aria-label="Archivo">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={kind === tab.id}
              className={`tmp-segment-btn${kind === tab.id ? ' is-on' : ''}`}
              onClick={() => { setKind(tab.id); setShown(PAGE) }}
            >
              <PhoneIcon name={tab.icon} size={15} />
              {tab.label}
              <span className="tmp-segment-count">{tab.count}</span>
            </button>
          ))}
        </div>
        <label className="tmp-search">
          <PhoneIcon name="search" size={16} />
          <input
            type="search"
            aria-label="Buscar"
            placeholder={kind === 'finished' ? 'Buscar en completadas' : 'Buscar en canceladas'}
            value={query}
            onChange={(event) => { setQuery(event.target.value); setShown(PAGE) }}
          />
        </label>
      </header>
      <main className="tmp-main tmp-main--archive">
        {visible.map((row, index) => (
          <button key={row.taskPath} type="button" className="tmp-archive-row" style={{ animationDelay: `${Math.min(index, 10) * 30}ms` }} onClick={() => setSelected(row)}>
            <span className={`tmp-archive-icon is-${kind}`}>
              <PhoneIcon name={kind === 'finished' ? 'check' : 'cancel'} size={15} strokeWidth={2.4} />
            </span>
            <span className="tmp-row-text">
              <span className="tmp-archive-title">{row.title}</span>
              <span className="tmp-archive-meta">
                <span><span className="tmp-dot tmp-dot--sm" style={row.groupColor ? { background: row.groupColor } : undefined} />{row.group || 'Sin grupo'}</span>
                <span className={`tmp-list-prio tmp-prio--${priorityTone(row.priority)}`}><span className="tmp-prio-dot" />{row.priority}</span>
              </span>
            </span>
            <span className="tmp-archive-kebab"><KebabIcon size={16} /></span>
          </button>
        ))}
        {rows.length === 0 ? (
          <div className="tmp-empty">{query.trim() ? `Nada coincide con «${query.trim()}».` : kind === 'finished' ? 'Todavía no hay tareas completadas.' : 'No hay tareas canceladas.'}</div>
        ) : null}
        {rows.length > shown ? (
          <div className="tmp-more">
            <span className="tmp-muted tmp-small">{`Mostrando ${shown} de ${rows.length}`}</span>
            <button type="button" className="tmp-btn tmp-btn--outline" onClick={() => setShown((count) => count + PAGE)}>Cargar 20 más</button>
          </div>
        ) : null}
      </main>
      {selected ? (
        <PhoneSheet label="Acciones" onClose={() => setSelected(null)}>
          <div className="tmp-sheet-head">
            <span className="tmp-sheet-kicker">{kind === 'finished' ? 'Completada' : 'Cancelada'} · de {selected.group || 'Sin grupo'}</span>
            <span className="tmp-sheet-heading">{selected.title}</span>
          </div>
          <div className="tmp-facts">
            <span><small>Prioridad</small><strong className={`tmp-prio--${priorityTone(selected.priority)} tmp-prio-text`}>{selected.priority}</strong></span>
            <span><small>Dedicado</small><strong className={selected.hoursLabel ? '' : 'tmp-muted'}>{selected.hoursLabel ?? '—'}</strong></span>
            <span><small>Período</small><strong className={selected.period ? '' : 'tmp-muted'}>{selected.period ?? 'Sin fechas'}</strong></span>
          </div>
          <button type="button" className="tmp-btn tmp-btn--primary tmp-btn--wide tmp-btn--tall" onClick={() => { onRestore(selected.taskPath); setSelected(null) }}>
            <PhoneIcon name="restore" size={16} strokeWidth={2.4} />
            Recuperar a {selected.group || 'Sin grupo'}
          </button>
          <button type="button" className="tmp-btn tmp-btn--danger tmp-btn--wide" onClick={() => { onDelete(selected.taskPath); setSelected(null) }}>
            <PhoneIcon name="trash" size={16} />
            Eliminar definitivamente
          </button>
        </PhoneSheet>
      ) : null}
    </div>
  )
}
