import { useEffect, useMemo, useRef, useState } from 'react'
import { useConfirmationEngine } from '../../../../context/confirmation/useConfirmationEngine'
import type { TaskArchiveRow } from '../../types/taskBoardTypes'
import '../../styles/taskManagerTokens.css'
import '../../styles/taskArchive.css'

export interface TaskArchiveViewProps {
  kind: 'finished' | 'cancelled'
  /** Rows already filtered by the shell's search and filters, newest first. */
  rows: TaskArchiveRow[]
  /** Total before filtering, for «56 tareas». */
  total: number
  onOpen: (row: TaskArchiveRow) => void
  /** Back to its column as Pendiente. */
  onRestore: (taskPaths: string[]) => Promise<void>
  onDelete: (taskPaths: string[]) => Promise<void>
  /** Read-only sessions hide restore/delete. */
  canEdit: boolean
}

/** Completadas loads in pages of this size; Canceladas shows every row. */
const PAGE_SIZE = 20

const COPY = {
  finished: {
    title: 'Completadas',
    section: 'Tareas completadas',
    groupHeader: 'Grupo',
    empty: 'No hay tareas completadas.',
    noMatch: 'Ninguna tarea completada coincide con la búsqueda o los filtros.',
  },
  cancelled: {
    title: 'Canceladas',
    section: 'Tareas canceladas',
    groupHeader: 'Grupo de origen',
    empty: 'No hay tareas canceladas.',
    noMatch: 'Ninguna tarea cancelada coincide con la búsqueda o los filtros.',
  },
} as const

const PRIORITY_TONE: Record<TaskArchiveRow['priority'], string> = {
  Atrasado: 'overdue',
  Urgente: 'urgent',
  Alta: 'high',
  Media: 'medium',
  Baja: 'low',
}

export function TaskArchiveView({ kind, rows, total, onOpen, onRestore, onDelete, canEdit }: TaskArchiveViewProps) {
  const { confirm } = useConfirmationEngine()
  const copy = COPY[kind]
  const [page, setPage] = useState<{ kind: TaskArchiveViewProps['kind']; limit: number }>({ kind, limit: PAGE_SIZE })
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set())
  const [pending, setPending] = useState(false)
  const selectAllRef = useRef<HTMLInputElement | null>(null)

  const limit = page.kind === kind ? page.limit : PAGE_SIZE
  const visibleRows = kind === 'finished' ? rows.slice(0, limit) : rows
  const remaining = rows.length - visibleRows.length
  const selectedPaths = useMemo(
    () => rows.filter((row) => selected.has(row.taskPath)).map((row) => row.taskPath),
    [rows, selected],
  )
  const visibleSelected = visibleRows.filter((row) => selected.has(row.taskPath)).length
  const allVisibleSelected = visibleRows.length > 0 && visibleSelected === visibleRows.length

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = visibleSelected > 0 && !allVisibleSelected
    }
  }, [allVisibleSelected, visibleSelected])

  const toggleRow = (taskPath: string) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(taskPath)) next.delete(taskPath)
      else next.add(taskPath)
      return next
    })
  }

  const toggleAll = () => {
    setSelected(allVisibleSelected ? new Set() : new Set(visibleRows.map((row) => row.taskPath)))
  }

  const clearSelection = () => setSelected(new Set())

  const run = async (action: (taskPaths: string[]) => Promise<void>, taskPaths: string[]) => {
    if (taskPaths.length === 0 || pending) return
    setPending(true)
    try {
      await action(taskPaths)
      setSelected((current) => {
        const next = new Set(current)
        for (const taskPath of taskPaths) next.delete(taskPath)
        return next
      })
    } catch {
      // The shell reports the backend error; the selection stays for a retry.
    } finally {
      setPending(false)
    }
  }

  const askDelete = async (taskPaths: string[], title: string | null) => {
    if (taskPaths.length === 0 || pending) return
    const accepted = await confirm({
      title: taskPaths.length === 1 ? 'Eliminar tarea' : 'Eliminar tareas',
      message: title !== null
        ? `¿Eliminar «${title}»? Esta acción no se puede deshacer.`
        : `¿Eliminar ${taskPaths.length} tareas? Esta acción no se puede deshacer.`,
      confirmLabel: 'Eliminar',
      cancelLabel: 'Cancelar',
      tone: 'danger',
    })
    if (accepted) await run(onDelete, taskPaths)
  }

  const deleteSelection = () => {
    const single = selectedPaths.length === 1 ? rows.find((row) => row.taskPath === selectedPaths[0]) : undefined
    void askDelete(selectedPaths, single ? single.title : null)
  }

  const selectionLabel = selectedPaths.length === 1 ? '1 seleccionada' : `${selectedPaths.length} seleccionadas`
  const hasRows = rows.length > 0

  return (
    <section className="tm-archive" aria-label={copy.section} aria-busy={pending || undefined} data-kind={kind}>
      <div className="tm-archive-header">
        <h2 className="tm-archive-title">{copy.title}</h2>
        <span className="tm-archive-count">{total === 1 ? '1 tarea' : `${total} tareas`}</span>
        <span className="tm-archive-spacer" />
        {canEdit && selectedPaths.length > 0 ? (
          <div className="tm-archive-selection" role="group" aria-label="Acciones sobre la selección">
            <span className="tm-archive-selection-label" aria-live="polite">{selectionLabel}</span>
            <button type="button" className="tm-archive-selection-btn" disabled={pending} onClick={() => void run(onRestore, selectedPaths)}>
              <RestoreIcon size={14} />Recuperar
            </button>
            <button type="button" className="tm-archive-selection-btn is-danger" disabled={pending} onClick={deleteSelection}>
              <TrashIcon size={14} />Eliminar
            </button>
            <button type="button" className="tm-archive-selection-clear" aria-label="Limpiar selección" disabled={pending} onClick={clearSelection}>
              <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </div>
        ) : null}
        <span className="tm-archive-sort">
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 4v16M3.5 16.5L7 20l3.5-3.5M14 6h7M14 11h5M14 16h3" /></svg>
          Más recientes
        </span>
      </div>

      {hasRows ? (
        <>
          <div className="tm-archive-scroll">
            <table className="tm-archive-table">
              <thead>
                <tr>
                  {canEdit ? (
                    <th scope="col" className="tm-archive-col-check">
                      <label className="tm-archive-check">
                        <input
                          ref={selectAllRef}
                          type="checkbox"
                          aria-label="Seleccionar todas"
                          checked={allVisibleSelected}
                          disabled={pending}
                          onChange={toggleAll}
                        />
                      </label>
                    </th>
                  ) : null}
                  <th scope="col" className={canEdit ? undefined : 'is-first'}>Tarea</th>
                  <th scope="col" className="tm-archive-col-group">{copy.groupHeader}</th>
                  <th scope="col" className="tm-archive-col-priority">Prioridad</th>
                  <th scope="col" className="tm-archive-col-hours">Dedicado / Est.</th>
                  <th scope="col" className="tm-archive-col-period">Período</th>
                  {canEdit ? (
                    <th scope="col" className="tm-archive-col-actions"><span className="tm-archive-sr">Acciones</span></th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row, index) => {
                  const isSelected = selected.has(row.taskPath)
                  return (
                    <tr
                      key={row.taskPath}
                      className={`tm-archive-row${isSelected ? ' is-selected' : ''}`}
                      style={{ ['--tm-archive-row-index' as string]: Math.min(index, 12) }}
                    >
                      {canEdit ? (
                        <td className="tm-archive-col-check">
                          <label className="tm-archive-check">
                            <input
                              type="checkbox"
                              aria-label={`Seleccionar ${row.title}`}
                              checked={isSelected}
                              disabled={pending}
                              onChange={() => toggleRow(row.taskPath)}
                            />
                          </label>
                        </td>
                      ) : null}
                      <td className={canEdit ? undefined : 'is-first'}>
                        <span className="tm-archive-task">
                          {kind === 'finished' ? <FinishedIcon /> : <CancelledIcon />}
                          <button type="button" className="tm-archive-task-title" onClick={() => onOpen(row)}>
                            {row.title}
                          </button>
                        </span>
                      </td>
                      <td>
                        <GroupLabel group={row.group} color={row.groupColor} />
                      </td>
                      <td>
                        <span className="tm-archive-priority" data-priority={PRIORITY_TONE[row.priority]}>
                          <span className="tm-archive-priority-dot" aria-hidden="true" />
                          {row.priority}
                        </span>
                      </td>
                      <td className={`tm-archive-col-hours${row.hoursLabel ? '' : ' is-empty'}`}>
                        {row.hoursLabel ?? '—'}
                      </td>
                      <td className={`tm-archive-period${row.period ? '' : ' is-empty'}`}>
                        {row.period ?? 'Sin fechas'}
                      </td>
                      {canEdit ? (
                        <td className="tm-archive-col-actions">
                          <span className="tm-archive-row-actions">
                            <button
                              type="button"
                              className="tm-archive-restore"
                              aria-label={`Recuperar ${row.title}`}
                              disabled={pending}
                              onClick={() => void run(onRestore, [row.taskPath])}
                            >
                              <RestoreIcon size={13} />Recuperar
                            </button>
                            <button
                              type="button"
                              className="tm-archive-delete"
                              aria-label={`Eliminar ${row.title}`}
                              disabled={pending}
                              onClick={() => void askDelete([row.taskPath], row.title)}
                            >
                              <TrashIcon size={15} />
                            </button>
                          </span>
                        </td>
                      ) : null}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="tm-archive-footer">
            <span>Mostrando {visibleRows.length} de {rows.length}</span>
            {kind === 'finished' && remaining > 0 ? (
              <button
                type="button"
                className="tm-archive-more"
                onClick={() => setPage({ kind, limit: limit + PAGE_SIZE })}
              >
                Cargar {Math.min(PAGE_SIZE, remaining)} más
                <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
              </button>
            ) : null}
            {kind === 'cancelled' && canEdit ? <span>Recuperar devuelve la tarea a su grupo de origen.</span> : null}
          </div>
        </>
      ) : (
        <div className="tm-archive-empty" role="status">
          <span className="tm-archive-empty-icon" aria-hidden="true">
            {kind === 'finished' ? <FinishedIcon size={18} /> : <CancelledIcon size={18} />}
          </span>
          {total > 0 ? (
            <>
              <span className="tm-archive-empty-title">Sin coincidencias</span>
              <span className="tm-archive-empty-text">{copy.noMatch}</span>
            </>
          ) : (
            <span className="tm-archive-empty-title">{copy.empty}</span>
          )}
        </div>
      )}
    </section>
  )
}

function GroupLabel({ group, color }: { group: string; color: string | null }) {
  if (!group.trim()) {
    return (
      <span className="tm-archive-group is-none">
        <span className="tm-archive-group-dot is-none" aria-hidden="true" />
        Sin grupo
      </span>
    )
  }
  return (
    <span className="tm-archive-group">
      <span
        className="tm-archive-group-dot"
        aria-hidden="true"
        style={color ? { background: color } : undefined}
      />
      {group}
    </span>
  )
}

function FinishedIcon({ size = 15 }: { size?: number }) {
  return (
    <svg className="tm-archive-icon is-finished" aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 12.5l2.5 2.5 4.5-5" />
    </svg>
  )
}

function CancelledIcon({ size = 15 }: { size?: number }) {
  return (
    <svg className="tm-archive-icon is-cancelled" aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M6.5 17.5l11-11" />
    </svg>
  )
}

function RestoreIcon({ size }: { size: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 14L4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </svg>
  )
}

function TrashIcon({ size }: { size: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
    </svg>
  )
}
