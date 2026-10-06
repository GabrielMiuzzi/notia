import { ChevronRight, Clock, Mic, Search } from 'lucide-react'
import { formatClock } from './meetingDisplay'
import type { MeetingHistory } from './useMeetingHistory'
import type { MeetingHistoryItem } from '../../../../services/meeting/meetingTypes'

interface MeetingHistoryProps {
  history: MeetingHistory
  hasLibrary: boolean
}

/** «Reuniones anteriores» next to the ready stage on a wide view. */
export function MeetingHistoryPanel({ history, hasLibrary }: MeetingHistoryProps) {
  return (
    <aside className="notia-meeting-card notia-meeting-history" aria-labelledby="meeting-history-title">
      <div className="notia-meeting-history-head">
        <div className="notia-meeting-history-title">
          <Clock size={15} aria-hidden="true" />
          <h2 id="meeting-history-title">Reuniones anteriores</h2>
          {history.items ? <span className="notia-meeting-mono">{history.items.length}</span> : null}
        </div>
        <HistorySearch history={history} disabled={!hasLibrary} />
      </div>
      <div className="notia-meeting-history-scroll">
        <MeetingHistoryList history={history} hasLibrary={hasLibrary} />
      </div>
    </aside>
  )
}

/** «Reuniones anteriores» as its own screen on a phone. */
export function MeetingPhoneHistory({ history, hasLibrary, onNewMeeting }: MeetingHistoryProps & { onNewMeeting: () => void }) {
  return (
    <div className="notia-meeting-phone-history">
      <div className="notia-meeting-phone-history-head">
        <h1>Reuniones</h1>
        <HistorySearch history={history} disabled={!hasLibrary} />
      </div>
      <div className="notia-meeting-phone-history-list">
        <MeetingHistoryList history={history} hasLibrary={hasLibrary} />
      </div>
      <button type="button" className="notia-meeting-phone-history-new" onClick={onNewMeeting}>
        <Mic size={18} aria-hidden="true" />Nueva reunión
      </button>
    </div>
  )
}

function HistorySearch({ history, disabled }: { history: MeetingHistory; disabled: boolean }) {
  return (
    <label className="notia-meeting-history-search">
      <Search size={14} aria-hidden="true" />
      <input
        type="search"
        placeholder="Buscar por título o contenido"
        aria-label="Buscar reuniones"
        value={history.query}
        disabled={disabled}
        onChange={(event) => history.setQuery(event.target.value)}
      />
    </label>
  )
}

function MeetingHistoryList({ history, hasLibrary }: MeetingHistoryProps) {
  const { items, error, query, openingId } = history
  if (!hasLibrary) return <p className="notia-meeting-history-empty">Abrí una biblioteca para ver sus reuniones.</p>
  return (
    <>
      {error ? <p className="notia-meeting-error-text" role="alert">{error}</p> : null}
      {items === null ? (
        error ? null : <p className="notia-meeting-history-empty" role="status">Buscando reuniones…</p>
      ) : items.length === 0 ? (
        <p className="notia-meeting-history-empty">
          {query.trim() ? 'Ninguna reunión coincide con la búsqueda.' : 'Las reuniones que guardes como nota aparecen acá.'}
        </p>
      ) : (
        <ul className="notia-meeting-history-list">
          {items.map((item) => (
            <li key={item.id}>
              {item.group ? <p className="notia-meeting-history-group">{item.group}</p> : null}
              <HistoryItem item={item} opening={openingId === item.id} disabled={openingId !== null} onOpen={() => void history.open(item.id)} />
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

function HistoryItem({ item, opening, disabled, onOpen }: { item: MeetingHistoryItem; opening: boolean; disabled: boolean; onOpen: () => void }) {
  const people = item.speakerCount > 0 ? `${item.speakerCount} ${item.speakerCount === 1 ? 'hablante' : 'hablantes'}` : 'Sin hablantes'
  return (
    <button type="button" className="notia-meeting-history-item" onClick={onOpen} disabled={disabled} aria-busy={opening || undefined}>
      <span className="notia-meeting-history-row">
        <span className="notia-meeting-history-name">{item.title}</span>
        <span className="notia-meeting-mono notia-meeting-history-time">{opening ? 'Abriendo…' : item.timeLabel}</span>
        <ChevronRight size={14} aria-hidden="true" className="notia-meeting-history-chevron" />
      </span>
      <span className="notia-meeting-history-row notia-meeting-history-meta">
        <span className="notia-meeting-mono">{formatClock(item.durationMs)}</span>
        <span>{people}</span>
        {item.context ? (
          <span className="notia-meeting-history-context">
            <span className="notia-meeting-history-swatch" style={item.context.color ? { background: item.context.color } : undefined} aria-hidden="true" />
            {item.context.label}
          </span>
        ) : null}
      </span>
      {item.pendingTasks > 0 ? (
        <span className="notia-meeting-history-tasks">
          {item.pendingTasks} {item.pendingTasks === 1 ? 'tarea pendiente' : 'tareas pendientes'}
        </span>
      ) : null}
    </button>
  )
}
