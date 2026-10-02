import type { ReactNode } from 'react'
import { ChevronRight, CircleDot, Dumbbell, LayoutGrid, Plus } from 'lucide-react'
import { NotiaModalShell } from '../../../components/notia/NotiaModalShell'
import type { RoutineRow } from '../types/gymTypes'

/*
 * Las piezas propias de la versión celular de Gimnasio (canvas «Munin —
 * Rutinas», tablero «Versión celular»): la barra de secciones de abajo, la
 * lista de rutinas y las hojas que suben desde abajo.
 */

export type PhoneTab = 'panel' | 'rutinas' | 'equipo'

interface PhoneTabBarProps {
  current: PhoneTab
  onPanel: () => void
  onRoutines: () => void
  onEquipment: () => void
}

export function PhoneTabBar({ current, onPanel, onRoutines, onEquipment }: PhoneTabBarProps) {
  const tab = (key: PhoneTab, label: string, icon: ReactNode, onClick: () => void) => (
    <button type="button" className="gym-tab" aria-current={current === key ? 'page' : undefined} onClick={onClick}>
      {icon}
      {label}
    </button>
  )
  return (
    <nav className="gym-tabbar" aria-label="Secciones de entrenamiento">
      {tab('panel', 'Panel', <LayoutGrid size={22} aria-hidden="true" />, onPanel)}
      {tab('rutinas', 'Rutinas', <Dumbbell size={22} aria-hidden="true" />, onRoutines)}
      {tab('equipo', 'Equipamiento', <CircleDot size={22} aria-hidden="true" />, onEquipment)}
    </nav>
  )
}

interface PhoneRoutineListProps {
  routines: RoutineRow[]
  onCreate: () => void
  onOpen: (routineId: string) => void
}

/** Rutinas: una tarjeta por rutina; tocarla la abre. */
export function PhoneRoutineList({ routines, onCreate, onOpen }: PhoneRoutineListProps) {
  return (
    <main className="gym-main gym-phone-list">
      <header className="gym-phone-list-head">
        <h1 className="gym-h1">Rutinas</h1>
        <button type="button" className="gym-button gym-button--primary" onClick={onCreate}><Plus size={18} aria-hidden="true" />Nueva</button>
      </header>
      {routines.length === 0 ? <p className="gym-muted gym-empty-note">Todavía no tenés rutinas. Creá la primera con Nueva.</p> : null}
      {routines.map((row) => (
        <button key={row.id} type="button" className="gym-phone-routine" data-color={row.color} onClick={() => onOpen(row.id)}>
          <span className="gym-swatch gym-swatch--routine" aria-hidden="true" />
          <span className="gym-phone-routine-text">
            <span className="gym-phone-routine-name">{row.name}</span>
            <span className="gym-muted">{row.focus}</span>
            <span className="gym-routine-row-meta"><span>{row.count}</span><span>{row.days}</span></span>
          </span>
          <ChevronRight size={18} aria-hidden="true" />
        </button>
      ))}
    </main>
  )
}

interface PhoneSheetProps {
  label: string
  onClose: () => void
  /** Ocupa casi toda la pantalla (una lista que se recorre). */
  tall?: boolean
  children: ReactNode
}

/** Una hoja que sube desde abajo, con su manija. */
export function PhoneSheet({ label, onClose, tall = false, children }: PhoneSheetProps) {
  return (
    <NotiaModalShell open onClose={onClose} size="md" panelClassName={`gym-modal-panel gym-sheet${tall ? ' gym-sheet--tall' : ''}`}>
      <div className="gym-sheet-body" role="dialog" aria-modal="true" aria-label={label}>
        <span className="gym-sheet-handle" aria-hidden="true" />
        {children}
      </div>
    </NotiaModalShell>
  )
}
