import type { AiActionsDashboard } from '../types/aiActionsTypes'
import { KindMark } from './aiActionsVisuals'

/** Panel «Hoy»: todas las ejecuciones del día, en orden, con el marcador AHORA. */
export function AiActionsTimeline({ dashboard }: { dashboard: AiActionsDashboard }) {
  const { progress } = dashboard
  return (
    <aside className="aia-today" aria-labelledby="aia-today-title">
      <div className="aia-today__accent" aria-hidden="true" />
      <div className="aia-today__head">
        <div className="aia-today__title-row">
          <h2 id="aia-today-title">Hoy</h2>
          <span>{dashboard.shortDate}</span>
        </div>
        <div className="aia-today__progress">
          <div className="aia-today__progress-label">
            <span>{progress.done} de {progress.total} ejecuciones</span>
            <span>{progress.percent}%</span>
          </div>
          <div
            className="aia-today__bar"
            role="progressbar"
            aria-label="Ejecuciones de hoy"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress.percent}
          >
            <div style={{ width: `${progress.percent}%` }} />
          </div>
        </div>
      </div>
      <ol className="aia-today__list">
        {dashboard.timeline.map((entry, index) => entry.type === 'now' ? (
          <li key={`now-${index}`} className="aia-now">
            <span className="aia-now__time">{entry.time}</span>
            <span className="aia-now__line" aria-hidden="true" />
            <span className="aia-now__label">AHORA</span>
          </li>
        ) : (
          <li key={`${entry.item.actionId}-${entry.item.time}-${index}`} className="aia-run" data-tone={entry.item.tone}>
            <span className="aia-run__time">{entry.item.time}</span>
            <span className="aia-run__rail" aria-hidden="true">
              <span className="aia-run__dot" />
              <span className="aia-run__line" />
            </span>
            <span className="aia-run__body">
              <span className="aia-run__name">{entry.item.name}</span>
              <span className="aia-run__meta">
                <KindMark kind={entry.item.kind} />
                {entry.item.kindLabel}
                {entry.item.note && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="aia-run__note">{entry.item.note}</span>
                  </>
                )}
              </span>
            </span>
          </li>
        ))}
      </ol>
      {dashboard.timeline.length <= 1 && <p className="aia-today__empty">No hay ejecuciones para hoy.</p>}
    </aside>
  )
}
