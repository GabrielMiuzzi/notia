import { ListChecks } from 'lucide-react'
import type { NotiaLibrary } from '../../../../types/notia'
import type { HomeCard, HomeTasks } from '../../../../services/home/homeTypes'
import { HomeCardShell, HomeMoreButton } from './HomeCardShell'
import { HomePomodoro } from './HomePomodoro'
import { countLabel } from './homeDisplay'

interface HomeTasksCardProps {
  card: HomeCard<HomeTasks>
  library: NotiaLibrary
  onOpenBoard: () => void
  onOpenTask: (path: string) => void
}

/** The usual columns of the Task Manager, the most urgent tickets and the Pomodoro. */
export function HomeTasksCard({ card, library, onOpenBoard, onOpenTask }: HomeTasksCardProps) {
  const tasks = card.data
  return (
    <HomeCardShell
      id="home-tasks-title"
      title="Tareas"
      note={tasks ? countLabel(tasks.completed, 'completada', 'completadas') : undefined}
      icon={<ListChecks size={15} strokeWidth={1.75} />}
      className="home-card--tasks"
      error={card.error}
      action={<HomeMoreButton label="Abrir Task Manager" onClick={onOpenBoard} />}
    >
      {tasks ? (
        <>
          <div className="home-stats">
            <button type="button" className="home-stat" onClick={onOpenBoard}>
              <b className="home-stat__value--accent">{tasks.sprint}</b>
              <span>Sprint actual</span>
            </button>
            <button type="button" className="home-stat" onClick={onOpenBoard}>
              <b>{tasks.review}</b>
              <span>En revisión</span>
            </button>
            <button type="button" className="home-stat" onClick={onOpenBoard}>
              <b className={tasks.blocked > 0 ? 'home-stat__value--urgent' : undefined}>{tasks.blocked}</b>
              <span>{tasks.blocked === 1 ? 'Bloqueada' : 'Bloqueadas'}</span>
            </button>
          </div>
          <div className="home-label">Lo más urgente</div>
          <div className="home-scroll home-rows home-rows--tasks">
            {tasks.urgent.length === 0 ? <p className="home-empty">No hay tareas abiertas.</p> : null}
            {tasks.urgent.map((task) => (
              <button key={task.filePath} type="button" className="home-row" onClick={() => onOpenTask(task.path)}>
                <span className="home-row__text">
                  <span className="home-row__title">{task.title}</span>
                  <span className="home-row__meta">{task.meta}</span>
                </span>
                <span className="home-chip" data-chip={task.chip}><i aria-hidden="true" />{task.chipLabel}</span>
              </button>
            ))}
          </div>
          <HomePomodoro library={library} focus={tasks.focus ?? null} />
        </>
      ) : null}
    </HomeCardShell>
  )
}
