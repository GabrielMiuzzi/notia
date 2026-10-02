import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, X } from 'lucide-react'
import type { NotiaLibrary } from '../../../types/notia'
import { useGymView } from '../hooks/useGymView'
import { usePhoneLayout } from '../hooks/usePhoneLayout'
import { applyCatalogMutation, asGymError } from '../services/gymService'
import type { GymMutation } from '../types/gymTypes'
import { EquipmentScreen } from './EquipmentScreen'
import { ExerciseCard } from './ExerciseCard'
import { PhoneRoutineList, PhoneTabBar, type PhoneTab } from './GymPhone'
import { PanelScreen } from './PanelScreen'
import { RoutinesScreen } from './RoutinesScreen'
import { TrainingScreen } from './TrainingScreen'
import '../styles/gym.css'

interface CardState {
  exerciseId: string
  editable: boolean
}

/**
 * Gimnasio: el panel, las rutinas, el entrenamiento y el equipamiento. Con
 * el espacio de un celular sigue la versión celular del diseño: secciones
 * abajo, la lista de rutinas como pantalla y las hojas que suben.
 */
export function GymDashboardView({ library }: { library: NotiaLibrary }) {
  const gym = useGymView(library)
  const { view, query, updateQuery, apply, notice, setNotice } = gym
  const [card, setCard] = useState<CardState | null>(null)
  const [clockOffset, setClockOffset] = useState(0)
  const [root, setRoot] = useState<HTMLElement | null>(null)
  const phone = usePhoneLayout(root)
  // Celular: la lista de rutinas (antes de abrir una) y la hoja de ejercicios.
  const [listing, setListing] = useState(false)
  const [libraryOpen, setLibraryOpen] = useState(false)

  // El reloj de la sesión usa la hora de Rust (el host, si es un cliente).
  const serverNow = view?.nowMs
  useEffect(() => {
    if (serverNow) setClockOffset(serverNow - Date.now())
  }, [serverNow])

  const screen = query.screen
  const selectedRoutine = view?.routineId ?? null
  // Estables, para que la lista de ejercicios no se vuelva a dibujar con cada cambio de pantalla.
  const actions = useMemo(() => ({
    toPanel: () => {
      setListing(false)
      updateQuery({ screen: 'panel' })
    },
    toRoutines: () => updateQuery({ screen: 'rutinas' }),
    toRoutineList: () => {
      setListing(true)
      updateQuery({ screen: 'rutinas' })
    },
    toEquipment: () => {
      setListing(false)
      setLibraryOpen(false)
      updateQuery({ screen: 'equipo' })
    },
    openRoutine: (routineId: string) => {
      setListing(false)
      updateQuery({ screen: 'rutinas', routineId })
    },
    train: (routineId: string) => {
      setListing(false)
      updateQuery({ screen: 'entrenar', routineId })
    },
    apply: (mutation: GymMutation) => { void apply(mutation) },
    // Una rutina nueva se abre para editarla.
    createRoutine: () => {
      void apply({ type: 'create-routine' }).then((routineId) => {
        if (!routineId) return
        setListing(false)
        updateQuery({ screen: 'editar', routineId })
      })
    },
    search: (search: string) => updateQuery({ search }),
    group: (group: string | null) => updateQuery({ group }),
    onlyMine: (onlyMine: boolean) => updateQuery({ onlyMine }),
    openExercise: (exerciseId: string, editable: boolean) => setCard({ exerciseId, editable }),
  }), [apply, updateQuery])

  const currentGroup = query.group
  const createExercise = useCallback(() => {
    void applyCatalogMutation(library, { type: 'create-exercise', group: currentGroup })
      .then((result) => {
        if (result.exercise) setCard({ exerciseId: result.exercise.id, editable: true })
      })
      .catch((reason: unknown) => setNotice(asGymError(reason).message))
  }, [library, currentGroup, setNotice])

  if (!view) {
    return (
      <main ref={setRoot} className="notia-main gym-view gym-view--state" role={gym.status === 'error' ? 'alert' : 'status'}>
        {gym.status === 'error' ? gym.loadError : 'Cargando Gimnasio…'}
      </main>
    )
  }

  const showList = phone && listing && screen === 'rutinas'
  const tab: PhoneTab | null = phone
    ? screen === 'panel' ? 'panel' : screen === 'equipo' ? 'equipo' : screen === 'rutinas' ? 'rutinas' : null
    : null

  return (
    <div ref={setRoot} className="notia-main gym-view" data-screen={screen} data-layout={phone ? 'phone' : undefined}>
      {view.exerciseTotal === 0 ? (
        <p className="gym-banner" role="status">No hay ejercicios en Gym/exercises de esta biblioteca. Cargá el catálogo o creá ejercicios desde Editar.</p>
      ) : null}
      {!view.sexFromProfile ? (
        <p className="gym-banner gym-banner--soft" role="status">El cuerpo se muestra masculino: configurá tu sexo en el perfil de Salud para ver el que corresponde.</p>
      ) : null}
      {notice ? (
        <div className="gym-notice" role="alert">
          <span>{notice}</span>
          <button type="button" className="gym-icon-button" aria-label="Cerrar aviso" onClick={() => setNotice(null)}><X size={16} /></button>
        </div>
      ) : null}

      {screen === 'panel' && view.panel ? (
        <PanelScreen
          panel={view.panel}
          body={gym.body}
          equipmentOwned={view.equipmentOwned}
          equipmentTotal={view.equipmentTotal}
          onEquipment={actions.toEquipment}
          onRoutines={actions.toRoutines}
          onStart={actions.train}
          onPickDay={(day) => updateQuery({ day })}
          phone={phone}
        />
      ) : null}

      {showList ? <PhoneRoutineList routines={view.routines} onCreate={actions.createRoutine} onOpen={actions.openRoutine} /> : null}

      {(screen === 'rutinas' || screen === 'editar') && !showList ? (
        <RoutinesScreen
          editing={screen === 'editar'}
          routines={view.routines}
          routine={view.routine}
          library={view.library}
          groups={view.groups}
          body={gym.body}
          search={query.search}
          group={query.group}
          onlyMine={query.onlyMine}
          apply={actions.apply}
          onPanel={actions.toPanel}
          onSelect={(routineId) => updateQuery({ routineId })}
          onEdit={() => updateQuery({ screen: 'editar', routineId: selectedRoutine })}
          onView={() => {
            setLibraryOpen(false)
            updateQuery({ screen: 'rutinas', routineId: selectedRoutine })
          }}
          onTrain={() => selectedRoutine && actions.train(selectedRoutine)}
          onEquipment={actions.toEquipment}
          onSearch={actions.search}
          onGroup={actions.group}
          onOnlyMine={actions.onlyMine}
          onOpenExercise={actions.openExercise}
          onCreateExercise={createExercise}
          phone={phone}
          onBackToList={actions.toRoutineList}
          libraryOpen={libraryOpen}
          onCloseLibrary={() => setLibraryOpen(false)}
        />
      ) : null}

      {screen === 'entrenar' ? (
        view.training ? (
          <TrainingScreen
            training={view.training}
            clockOffsetMs={clockOffset}
            apply={actions.apply}
            applying={gym.applying}
            onBack={() => updateQuery({ screen: 'rutinas', routineId: view.training?.routineId ?? selectedRoutine })}
            onOpenExercise={(exerciseId) => setCard({ exerciseId, editable: false })}
            phone={phone}
          />
        ) : (
          <main className="gym-main"><div className="gym-empty">Creá una rutina para entrenar.</div></main>
        )
      ) : null}

      {screen === 'equipo' && view.equipment ? (
        <EquipmentScreen library={library} equipment={view.equipment} apply={actions.apply} onBack={actions.toPanel} onNotice={setNotice} phone={phone} />
      ) : null}

      {phone && screen === 'editar' && view.routine ? (
        <div className="gym-phone-bar">
          <button type="button" className="gym-button gym-button--primary gym-button--big gym-button--wide" onClick={() => setLibraryOpen(true)}>
            <Plus size={18} aria-hidden="true" />Agregar ejercicio
          </button>
        </div>
      ) : null}
      {tab ? <PhoneTabBar current={tab} onPanel={actions.toPanel} onRoutines={actions.toRoutineList} onEquipment={actions.toEquipment} /> : null}

      {card ? (
        <ExerciseCard
          library={library}
          exerciseId={card.exerciseId}
          editable={card.editable}
          canEdit={screen === 'rutinas'}
          groups={view.groups}
          body={gym.body}
          onClose={() => setCard(null)}
          onEdit={() => {
            updateQuery({ screen: 'editar', routineId: selectedRoutine })
            setCard({ ...card, editable: true })
          }}
          onNotice={setNotice}
          phone={phone}
        />
      ) : null}
    </div>
  )
}
