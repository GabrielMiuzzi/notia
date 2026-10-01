import { useState } from 'react'
import { AlertTriangle, Check, ChevronDown, ChevronLeft, ChevronUp, Clock, Copy, Info, Minus, Pencil, Play, Plus, Search, Trash2, X } from 'lucide-react'
import type { BodyView, Choice, GymMutation, ItemView, LibraryView, RoutineRow, RoutineView } from '../types/gymTypes'
import { useConfirmationEngine } from '../../../context/confirmation/useConfirmationEngine'
import { BodyGraph } from './BodyGraph'
import { CommitInput } from './GymInputs'

const DAY_LETTERS = ['L', 'M', 'X', 'J', 'V', 'S', 'D']
const DAY_NAMES = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']

interface RoutinesScreenProps {
  editing: boolean
  routines: RoutineRow[]
  routine: RoutineView | null
  library: LibraryView | null
  groups: Choice[]
  body: BodyView | null
  search: string
  group: string | null
  onlyMine: boolean
  apply: (mutation: GymMutation) => void
  onPanel: () => void
  onSelect: (routineId: string) => void
  onEdit: () => void
  onView: () => void
  onTrain: () => void
  onEquipment: () => void
  onSearch: (search: string) => void
  onGroup: (group: string | null) => void
  onOnlyMine: (onlyMine: boolean) => void
  onOpenExercise: (exerciseId: string, editable: boolean) => void
  onCreateExercise: () => void
}

export function RoutinesScreen(props: RoutinesScreenProps) {
  const { editing, routines, routine, apply } = props
  const { confirm } = useConfirmationEngine()
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const isOpen = (item: ItemView, index: number) => open[item.id] ?? index === 0
  const toggle = (item: ItemView, index: number) => setOpen((current) => ({ ...current, [item.id]: !isOpen(item, index) }))

  return (
    <div className="gym-routines">
      <aside className="gym-routine-list" aria-label="Tus rutinas">
        <div className="gym-routine-list-head">
          <button type="button" className="gym-back" onClick={props.onPanel}><ChevronLeft size={16} aria-hidden="true" />Panel de entrenamiento</button>
          <h1 className="gym-h1 gym-h1--small">Rutinas</h1>
          <button type="button" className="gym-button gym-button--primary gym-button--wide" onClick={() => apply({ type: 'create-routine' })}>
            <Plus size={18} aria-hidden="true" />Nueva rutina
          </button>
        </div>
        <div className="gym-routine-list-body">
          {routines.length === 0 ? <p className="gym-muted gym-empty-note">Todavía no tenés rutinas. Creá la primera con Nueva rutina.</p> : null}
          {routines.map((row) => (
            <button
              key={row.id}
              type="button"
              className="gym-routine-row"
              aria-current={row.selected ? 'true' : undefined}
              data-color={row.color}
              onClick={() => props.onSelect(row.id)}
            >
              <span className="gym-routine-row-title">
                <span className="gym-swatch gym-swatch--routine" aria-hidden="true" />
                <span className="gym-routine-row-name">{row.name}</span>
              </span>
              <span className="gym-muted">{row.focus}</span>
              <span className="gym-routine-row-meta"><span>{row.count}</span><span>{row.days}</span></span>
            </button>
          ))}
        </div>
      </aside>

      {routine ? (
        <>
          <main className="gym-main gym-routine-main">
            <header className="gym-routine-header">
              <div className="gym-routine-header-row">
                {editing ? (
                  <div className="gym-routine-titles">
                    <CommitInput className="gym-title-input" aria-label="Nombre de la rutina" placeholder="Nombre de la rutina" value={routine.name} onCommit={(name) => apply({ type: 'rename-routine', routineId: routine.id, name })} />
                    <CommitInput className="gym-focus-input" aria-label="Enfoque de la rutina" placeholder="Agregá un enfoque, por ejemplo: Pecho y tríceps" value={routine.focus} onCommit={(focus) => apply({ type: 'set-focus', routineId: routine.id, focus })} />
                  </div>
                ) : (
                  <div className="gym-routine-titles">
                    <h2 className="gym-h1">{routine.name}</h2>
                    <span className="gym-muted">{routine.focusLabel}</span>
                  </div>
                )}
                <div className="gym-header-actions">
                  {editing ? (
                    <>
                      <span className="gym-editing"><Pencil size={14} aria-hidden="true" />Editando</span>
                      <button type="button" className="gym-button gym-button--primary" onClick={props.onView}><Check size={16} aria-hidden="true" />Listo</button>
                      <button type="button" className="gym-icon-button gym-icon-button--boxed" aria-label="Duplicar rutina" onClick={() => apply({ type: 'duplicate-routine', routineId: routine.id })}><Copy size={17} /></button>
                      <button
                        type="button"
                        className="gym-icon-button gym-icon-button--boxed gym-icon-button--danger"
                        aria-label="Eliminar rutina"
                        onClick={() => {
                          void confirm({
                            title: 'Eliminar rutina',
                            message: `¿Eliminar «${routine.name}»? El historial de entrenamientos se conserva.`,
                            confirmLabel: 'Eliminar',
                            cancelLabel: 'Cancelar',
                          }).then((accepted) => {
                            if (accepted) apply({ type: 'delete-routine', routineId: routine.id })
                          })
                        }}
                      ><Trash2 size={17} /></button>
                    </>
                  ) : (
                    <>
                      <button type="button" className="gym-button" onClick={props.onEdit}><Pencil size={16} aria-hidden="true" />Editar</button>
                      <button type="button" className="gym-button gym-button--primary" onClick={props.onTrain}><Play size={14} fill="currentColor" aria-hidden="true" />{routine.trainLabel}</button>
                    </>
                  )}
                </div>
              </div>
              <div className="gym-routine-header-row gym-routine-header-row--wrap">
                <div role="group" aria-label="Días de la semana" className="gym-days">
                  <span className="gym-muted">Días</span>
                  {DAY_LETTERS.map((letter, day) => editing ? (
                    <button key={letter} type="button" className="gym-day-chip" aria-pressed={routine.days[day]} aria-label={DAY_NAMES[day]} onClick={() => apply({ type: 'toggle-day', routineId: routine.id, day })}>{letter}</button>
                  ) : (
                    <span key={letter} className="gym-day-chip" data-on={routine.days[day] || undefined} title={DAY_NAMES[day]}>{letter}</span>
                  ))}
                </div>
                {editing ? (
                  <div className="gym-inline-stats">
                    <span><strong>{routine.stats.exercises}</strong>ejercicios</span>
                    <span><strong>{routine.stats.sets}</strong>series</span>
                    <span><strong>{routine.stats.volume}</strong>kg de volumen</span>
                  </div>
                ) : null}
              </div>
            </header>

            {routine.items.length === 0 ? (
              <div className="gym-empty">
                {editing ? (
                  <>
                    <strong>Esta rutina todavía no tiene ejercicios</strong>
                    <span>Elegí uno de la lista. Cada ejercicio arranca con 3 series de 10 repeticiones que podés ajustar.</span>
                  </>
                ) : 'Esta rutina todavía no tiene ejercicios. Tocá Editar para sumarlos.'}
              </div>
            ) : null}

            <section aria-label="Ejercicios de la rutina" className="gym-items">
              {routine.items.map((item, index) => {
                const expanded = isOpen(item, index)
                return (
                  <article key={item.id} className="gym-item" data-group={item.group}>
                    <div className="gym-item-head">
                      <button type="button" className="gym-item-toggle" aria-expanded={expanded} onClick={() => toggle(item, index)}>
                        <span className="gym-item-number">{item.n}</span>
                        <span className="gym-item-text">
                          <span className="gym-item-name">{item.name}</span>
                          <span className="gym-item-meta">
                            <span className="gym-item-group"><span className="gym-dot gym-dot--group" aria-hidden="true" />{item.groupLabel}</span>
                            <span>{item.equipmentLabel}</span>
                            <span className="gym-item-rest"><Clock size={12} aria-hidden="true" />{item.restLabel} de descanso</span>
                          </span>
                          {item.missing ? <span className="gym-missing"><AlertTriangle size={13} aria-hidden="true" />{item.missing}</span> : null}
                        </span>
                        <span className="gym-item-summary">{item.summary}</span>
                        {expanded ? <ChevronUp size={18} aria-hidden="true" /> : <ChevronDown size={18} aria-hidden="true" />}
                      </button>
                      {editing ? (
                        <>
                          <button type="button" className="gym-icon-button" aria-label={`Editar ficha de ${item.name}`} onClick={() => props.onOpenExercise(item.exerciseId, true)}><Pencil size={17} /></button>
                          <button type="button" className="gym-icon-button" aria-label={`Quitar ${item.name} de la rutina`} onClick={() => apply({ type: 'remove-item', routineId: routine.id, itemId: item.id })}><Trash2 size={17} /></button>
                        </>
                      ) : (
                        <button type="button" className="gym-icon-button" aria-label={`Ver ficha de ${item.name}`} onClick={() => props.onOpenExercise(item.exerciseId, false)}><Info size={17} /></button>
                      )}
                    </div>
                    {expanded ? (
                      <div className="gym-sets">
                        <div className={`gym-set-row gym-set-row--head${editing ? ' gym-set-row--edit' : ''}`}>
                          <span>Serie</span>
                          <span>{editing ? 'Peso (kg)' : 'Peso'}</span>
                          <span>{item.timed ? 'Segundos' : 'Repeticiones'}</span>
                          <span className="gym-right">Volumen</span>
                          {editing ? <span /> : null}
                        </div>
                        {item.sets.map((set, setIndex) => editing ? (
                          <div key={setIndex} className="gym-set-row gym-set-row--edit">
                            <span className="gym-set-n">{setIndex + 1}</span>
                            {item.weighted ? (
                              <CommitInput className="gym-number-input" inputMode="decimal" aria-label={`Peso de la serie ${setIndex + 1}`} placeholder="0" value={set.weight} onCommit={(value) => apply({ type: 'set-value', routineId: routine.id, itemId: item.id, index: setIndex, field: 'weight', value })} />
                            ) : (
                              <span className="gym-bodyweight">Peso corporal</span>
                            )}
                            <CommitInput className="gym-number-input" inputMode="numeric" aria-label={`${item.timed ? 'Segundos' : 'Repeticiones'} de la serie ${setIndex + 1}`} placeholder="0" value={set.reps} onCommit={(value) => apply({ type: 'set-value', routineId: routine.id, itemId: item.id, index: setIndex, field: 'reps', value })} />
                            <span className="gym-right gym-muted">{set.volumeLabel}</span>
                            <button type="button" className="gym-icon-button" aria-label={`Quitar serie ${setIndex + 1}`} disabled={item.sets.length <= 1} onClick={() => apply({ type: 'remove-set', routineId: routine.id, itemId: item.id, index: setIndex })}><X size={16} /></button>
                          </div>
                        ) : (
                          <div key={setIndex} className="gym-set-row gym-set-row--view">
                            <span className="gym-set-n">{setIndex + 1}</span>
                            <span className="gym-figure">{set.weightLabel}</span>
                            <span className="gym-figure">{set.repsLabel}</span>
                            <span className="gym-right gym-muted">{set.volumeLabel}</span>
                          </div>
                        ))}
                        {editing ? (
                          <div className="gym-set-actions">
                            <button type="button" className="gym-text-button" onClick={() => apply({ type: 'add-set', routineId: routine.id, itemId: item.id })}><Plus size={18} aria-hidden="true" />Agregar serie</button>
                            <div role="group" aria-label="Descanso entre series" className="gym-rest-stepper">
                              <span className="gym-muted">Descanso entre series</span>
                              <button type="button" className="gym-step-button" aria-label="Restar 15 segundos de descanso" onClick={() => apply({ type: 'adjust-rest', routineId: routine.id, itemId: item.id, deltaS: -15 })}><Minus size={14} /></button>
                              <span className="gym-rest-value">{item.restLabel}</span>
                              <button type="button" className="gym-step-button" aria-label="Sumar 15 segundos de descanso" onClick={() => apply({ type: 'adjust-rest', routineId: routine.id, itemId: item.id, deltaS: 15 })}><Plus size={14} /></button>
                            </div>
                            <span className="gym-muted">{item.totalLabel}</span>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </article>
                )
              })}
            </section>
          </main>

          {editing && props.library ? (
            <LibraryAside {...props} routine={routine} library={props.library} />
          ) : (
            <aside className="gym-side" aria-label="Resumen de la rutina">
              <h2 className="gym-h2">Resumen</h2>
              <div className="gym-mini-stats">
                <div><span>Ejercicios</span><strong>{routine.stats.exercises}</strong></div>
                <div><span>Series</span><strong>{routine.stats.sets}</strong></div>
                <div><span>Volumen planificado</span><strong>{routine.stats.volume} kg</strong></div>
                <div><span>Descanso total</span><strong>{routine.summary.rest}</strong></div>
              </div>
              <section aria-label="Músculos que trabaja la rutina" className="gym-side-section">
                <h3 className="gym-h3">Músculos que trabaja</h3>
                <div className="gym-body-pair gym-body-pair--boxed">
                  <figure>
                    <BodyGraph figure={props.body?.front ?? null} tones={routine.summary.muscles} scale="level" height={228} label="Músculos de la rutina, de frente" />
                    <figcaption>Frente</figcaption>
                  </figure>
                  <figure>
                    <BodyGraph figure={props.body?.back ?? null} tones={routine.summary.muscles} scale="level" height={228} label="Músculos de la rutina, de espalda" />
                    <figcaption>Espalda</figcaption>
                  </figure>
                </div>
                <div className="gym-level-text">
                  <span data-level="2"><span className="gym-swatch" aria-hidden="true" /><span><strong>Principales:</strong> {routine.summary.primary}</span></span>
                  <span data-level="1"><span className="gym-swatch" aria-hidden="true" /><span><strong>Secundarios:</strong> {routine.summary.secondary}</span></span>
                </div>
              </section>
            </aside>
          )}
        </>
      ) : (
        <main className="gym-main">
          <div className="gym-empty">Creá una rutina para empezar a armar tus entrenamientos.</div>
        </main>
      )}
    </div>
  )
}

function LibraryAside(props: RoutinesScreenProps & { routine: RoutineView; library: LibraryView }) {
  const { routine, library, apply } = props
  return (
    <aside className="gym-side gym-library" aria-label="Lista de ejercicios">
      <div className="gym-library-head">
        <div>
          <h2 className="gym-h2">Ejercicios</h2>
          <span className="gym-muted">Tocá + para sumarlo a {routine.name}, o el nombre para ver su ficha</span>
        </div>
        <label className="gym-search">
          <Search size={16} aria-hidden="true" />
          <input type="search" aria-label="Buscar ejercicio" placeholder="Buscar ejercicio" value={props.search} onChange={(event) => props.onSearch(event.target.value)} />
        </label>
        <div role="group" aria-label="Grupo muscular" className="gym-chips">
          <button type="button" className="gym-chip" aria-pressed={!props.group} onClick={() => props.onGroup(null)}>Todos</button>
          {props.groups.map((group) => (
            <button key={group.key} type="button" className="gym-chip" data-group={group.key} aria-pressed={props.group === group.key} onClick={() => props.onGroup(group.key)}>
              <span className="gym-dot gym-dot--group" aria-hidden="true" />{group.label}
            </button>
          ))}
        </div>
        <div className="gym-library-filter">
          <button type="button" className="gym-switch" aria-pressed={props.onlyMine} onClick={() => props.onOnlyMine(!props.onlyMine)}>
            <span className="gym-switch-track" aria-hidden="true"><span className="gym-switch-knob" /></span>
            Solo con mi equipamiento
            <span className="gym-muted">{library.hiddenNote}</span>
          </button>
          <button type="button" className="gym-text-button" onClick={props.onEquipment}>Cambiar</button>
        </div>
      </div>
      <div className="gym-library-list">
        {library.rows.map((row) => (
          <div key={row.id} className="gym-library-row" data-group={row.group}>
            <span className="gym-dot gym-dot--group" aria-hidden="true" />
            <button type="button" className="gym-library-name" aria-label={`Ver ficha de ${row.name}`} onClick={() => props.onOpenExercise(row.id, true)}>
              <span className="gym-library-title" data-missing={row.missing ? true : undefined}>{row.name}</span>
              <span className="gym-muted">{row.meta}</span>
              {row.missing ? <span className="gym-missing"><AlertTriangle size={13} aria-hidden="true" />{row.missing}</span> : null}
            </button>
            {row.added ? (
              <span className="gym-added"><Check size={15} aria-hidden="true" />En la rutina</span>
            ) : (
              <button type="button" className="gym-add-button" aria-label={`Sumar ${row.name}`} onClick={() => apply({ type: 'add-exercise', routineId: routine.id, exerciseId: row.id })}><Plus size={18} /></button>
            )}
          </div>
        ))}
        {library.rows.length === 0 ? <div className="gym-empty-note">No hay ejercicios que coincidan con tu búsqueda. Probá con otro nombre o creá uno nuevo.</div> : null}
      </div>
      <div className="gym-library-foot">
        <button type="button" className="gym-dashed-button" onClick={props.onCreateExercise}><Plus size={17} aria-hidden="true" />Crear ejercicio</button>
      </div>
    </aside>
  )
}
