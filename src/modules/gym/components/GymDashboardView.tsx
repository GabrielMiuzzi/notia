import { useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import type { NotiaLibrary } from '../../../types/notia'
import { useGymView } from '../hooks/useGymView'
import { applyCatalogMutation, asGymError } from '../services/gymService'
import { EquipmentScreen } from './EquipmentScreen'
import { ExerciseCard } from './ExerciseCard'
import { PanelScreen } from './PanelScreen'
import { RoutinesScreen } from './RoutinesScreen'
import { TrainingScreen } from './TrainingScreen'
import '../styles/gym.css'

interface CardState {
  exerciseId: string
  editable: boolean
}

/** Gimnasio: el panel, las rutinas, el entrenamiento y el equipamiento. */
export function GymDashboardView({ library }: { library: NotiaLibrary }) {
  const gym = useGymView(library)
  const { view, query, updateQuery, apply, notice, setNotice } = gym
  const [card, setCard] = useState<CardState | null>(null)
  const [clockOffset, setClockOffset] = useState(0)

  // El reloj de la sesión usa la hora de Rust (el host, si es un cliente).
  const serverNow = view?.nowMs
  useEffect(() => {
    if (serverNow) setClockOffset(serverNow - Date.now())
  }, [serverNow])

  const screen = query.screen
  const selectedRoutine = view?.routineId ?? null
  const actions = useMemo(() => ({
    toPanel: () => updateQuery({ screen: 'panel' }),
    toRoutines: () => updateQuery({ screen: 'rutinas' }),
    toEquipment: () => updateQuery({ screen: 'equipo' }),
    train: (routineId: string) => updateQuery({ screen: 'entrenar', routineId }),
  }), [updateQuery])

  const createExercise = async () => {
    try {
      const result = await applyCatalogMutation(library, { type: 'create-exercise', group: query.group })
      if (result.exercise) setCard({ exerciseId: result.exercise.id, editable: true })
    } catch (reason) {
      setNotice(asGymError(reason).message)
    }
  }

  if (!view) {
    return (
      <main className="notia-main gym-view gym-view--state" role={gym.status === 'error' ? 'alert' : 'status'}>
        {gym.status === 'error' ? gym.loadError : 'Cargando Gimnasio…'}
      </main>
    )
  }

  return (
    <div className="notia-main gym-view" data-screen={screen}>
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
        />
      ) : null}

      {(screen === 'rutinas' || screen === 'editar') ? (
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
          apply={(mutation) => void apply(mutation)}
          onPanel={actions.toPanel}
          onSelect={(routineId) => updateQuery({ routineId })}
          onEdit={() => updateQuery({ screen: 'editar', routineId: selectedRoutine })}
          onView={() => updateQuery({ screen: 'rutinas', routineId: selectedRoutine })}
          onTrain={() => selectedRoutine && actions.train(selectedRoutine)}
          onEquipment={actions.toEquipment}
          onSearch={(search) => updateQuery({ search })}
          onGroup={(group) => updateQuery({ group })}
          onOnlyMine={(onlyMine) => updateQuery({ onlyMine })}
          onOpenExercise={(exerciseId, editable) => setCard({ exerciseId, editable })}
          onCreateExercise={() => void createExercise()}
        />
      ) : null}

      {screen === 'entrenar' ? (
        view.training ? (
          <TrainingScreen
            training={view.training}
            clockOffsetMs={clockOffset}
            apply={(mutation) => void apply(mutation)}
            onBack={() => updateQuery({ screen: 'rutinas', routineId: view.training?.routineId ?? selectedRoutine })}
            onOpenExercise={(exerciseId) => setCard({ exerciseId, editable: false })}
          />
        ) : (
          <main className="gym-main"><div className="gym-empty">Creá una rutina para entrenar.</div></main>
        )
      ) : null}

      {screen === 'equipo' && view.equipment ? (
        <EquipmentScreen library={library} equipment={view.equipment} apply={(mutation) => void apply(mutation)} onBack={actions.toPanel} onNotice={setNotice} />
      ) : null}

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
        />
      ) : null}
    </div>
  )
}
